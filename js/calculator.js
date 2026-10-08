(function attachProgramData(global) {
  'use strict';

  const HEADERS = ['연도', '사업ID', '사업명', '분야', '지역', '참여자수', '수료자수'];
  const FIELD_COLORS = {
    '교육': '#4f7cac',
    '일자리': '#f29e4c',
    '지역사회': '#56a764'
  };
  const FALLBACK_COLORS = ['#8f6bb3', '#d9668a', '#3f9e9a', '#c4a33c', '#64748b', '#b35c44'];

  function readRecords(text) {
    if (typeof text !== 'string') throw new TypeError('CSV 내용은 문자열이어야 합니다.');
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    let afterQuote = false;
    let line = 1;
    let recordLine = 1;
    let index = text.charCodeAt(0) === 0xFEFF ? 1 : 0;

    function finishField() {
      record.push(field);
      field = '';
      afterQuote = false;
    }
    function finishRecord() {
      finishField();
      if (record.some(value => value !== '')) records.push({ values: record, line: recordLine });
      record = [];
      recordLine = line + 1;
    }

    while (index < text.length) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          quoted = false;
          afterQuote = true;
          index += 1;
          continue;
        }
        if (char === '\r' || char === '\n') {
          field += char;
          if (char === '\r' && text[index + 1] === '\n') {
            field += '\n';
            index += 1;
          }
          line += 1;
          index += 1;
          continue;
        }
        field += char;
        index += 1;
        continue;
      }

      if (char === ',' ) {
        finishField();
        index += 1;
        continue;
      }
      if (char === '\r' || char === '\n') {
        finishRecord();
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        line += 1;
        recordLine = line;
        index += 1;
        continue;
      }
      if (char === '"') {
        if (field !== '' || afterQuote) throw new Error(`${line}행 CSV 따옴표 위치가 올바르지 않습니다.`);
        quoted = true;
        index += 1;
        continue;
      }
      if (afterQuote) throw new Error(`${line}행 CSV 따옴표 뒤에 예상하지 못한 문자가 있습니다.`);
      field += char;
      index += 1;
    }

    if (quoted) throw new Error(`${recordLine}행 CSV 따옴표가 닫히지 않았습니다.`);
    if (record.length || field !== '' || afterQuote) finishRecord();
    return records;
  }

  function parseCount(raw, row, property) {
    const value = raw.trim();
    if (value === '') return { value: null, missing: true, invalid: false };
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
      return { value: null, missing: false, invalid: true };
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return { value: null, missing: false, invalid: true };
    if (!Number.isInteger(number)) return { value: number, missing: false, invalid: false };
    return { value: number, missing: false, invalid: false };
  }

  function parseCsv(text, source) {
    const records = readRecords(text);
    if (!records.length || records[0].values.length !== HEADERS.length ||
        HEADERS.some((header, index) => records[0].values[index] !== header)) {
      throw new Error(`CSV 첫 행은 ${HEADERS.join(',')} 순서의 헤더여야 합니다.`);
    }
    const rows = [];
    for (const record of records.slice(1)) {
      if (record.values.length !== HEADERS.length) {
        throw new Error(`${record.line}행의 열 수가 올바르지 않습니다.`);
      }
      const values = record.values;
      const participants = parseCount(values[5], null, 'participants');
      const completers = parseCount(values[6], null, 'completers');
      rows.push({
        year: values[0], id: values[1], name: values[2], field: values[3], region: values[4],
        participants: participants.value, completers: completers.value,
        source: source || '입력 자료', line: record.line,
        _invalidNumbers: [participants.invalid ? 'participants' : null, completers.invalid ? 'completers' : null].filter(Boolean),
        _missingNumbers: [participants.missing ? 'participants' : null, completers.missing ? 'completers' : null].filter(Boolean)
      });
    }
    return rows;
  }

  function reject(row, reasonCode, reason, rejectedRows) {
    rejectedRows.push({ row, reasonCode, reason });
  }

  function validateRows(rows) {
    const validRows = [];
    const rejectedRows = [];
    const seen = new Set();
    for (const row of rows) {
      const missingLabel = ['year', 'id', 'name', 'field', 'region'].find(key =>
        row[key] == null || String(row[key]).trim() === '');
      if (missingLabel) {
        reject(row, 'missing_value', '필수 값이 비어 있습니다.', rejectedRows);
        continue;
      }
      const invalidNumber = (row._invalidNumbers || []).length > 0;
      if (invalidNumber) {
        reject(row, 'invalid_number', '참여자수 또는 수료자수가 숫자로 해석되지 않습니다.', rejectedRows);
        continue;
      }
      const missingNumber = (row._missingNumbers || []).length > 0 || row.participants == null || row.completers == null;
      if (missingNumber) {
        reject(row, 'missing_value', '참여자수 또는 수료자수가 비어 있습니다.', rejectedRows);
        continue;
      }
      if (row.participants < 0 || row.completers < 0) {
        reject(row, 'negative_count', '참여자수와 수료자수는 0 이상이어야 합니다.', rejectedRows);
        continue;
      }
      if (!Number.isInteger(row.participants) || !Number.isInteger(row.completers)) {
        reject(row, 'non_integer_count', '참여자수와 수료자수는 정수여야 합니다.', rejectedRows);
        continue;
      }
      if (row.completers > row.participants) {
        reject(row, 'completers_exceed_participants', '수료자수가 참여자수보다 많습니다.', rejectedRows);
        continue;
      }
      const key = `${row.year}\u0000${row.id}`;
      if (seen.has(key)) {
        reject(row, 'duplicate', '연도와 사업ID가 같은 유효 행이 이미 있습니다.', rejectedRows);
        continue;
      }
      seen.add(key);
      validRows.push(row);
    }
    return { validRows, rejectedRows };
  }

  function rate(completers, participants) {
    return participants === 0 ? null : completers / participants * 100;
  }

  function fieldColor(key) {
    if (Object.prototype.hasOwnProperty.call(FIELD_COLORS, key)) return FIELD_COLORS[key];
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
  }

  function buildView(validRows, selectedYears, threshold = 70) {
    const years = selectedYears === undefined
      ? Array.from(new Set(validRows.map(row => row.year)))
      : selectedYears.slice();
    const yearSet = new Set(years);
    const rows = validRows.filter(row => yearSet.has(row.year));
    const participants = rows.reduce((sum, row) => sum + row.participants, 0);
    const completers = rows.reduce((sum, row) => sum + row.completers, 0);
    const summary = {
      participants,
      completers,
      completionRate: rate(completers, participants),
      programCount: new Set(rows.map(row => row.id)).size,
      selectedYearCount: years.length,
      cautionCount: rows.filter(row => {
        const value = rate(row.completers, row.participants);
        return value !== null && value < threshold;
      }).length,
      validRowCount: rows.length,
      uncalculableCount: rows.filter(row => row.participants === 0).length
    };

    const fields = new Map();
    const programs = new Map();
    const yearly = new Map();
    for (const year of years) yearly.set(year, { year, participants: 0, completers: 0 });
    for (const row of rows) {
      const field = fields.get(row.field) || { key: row.field, participants: 0 };
      field.participants += row.participants;
      fields.set(row.field, field);

      const program = programs.get(row.id) || { id: row.id, name: row.name, participants: 0, completers: 0 };
      program.participants += row.participants;
      program.completers += row.completers;
      programs.set(row.id, program);

      const year = yearly.get(row.year) || { year: row.year, participants: 0, completers: 0 };
      year.participants += row.participants;
      year.completers += row.completers;
      yearly.set(row.year, year);
    }
    const fieldShare = Array.from(fields.values(), item => ({
      ...item,
      share: participants === 0 ? null : item.participants / participants * 100,
      color: fieldColor(item.key)
    }));
    const programComparison = Array.from(programs.values());
    const yearlyCompletion = Array.from(yearly.values())
      .sort((a, b) => String(a.year).localeCompare(String(b.year), 'en', { numeric: true }))
      .map(item => ({ ...item, completionRate: rate(item.completers, item.participants) }));
    const tableRows = rows.map(row => {
      const completionRate = rate(row.completers, row.participants);
      return { ...row, completionRate, status: completionRate === null ? 'uncalculable' : completionRate < threshold ? 'caution' : 'ok' };
    });

    return {
      selectedYears: years,
      threshold,
      rows,
      summary,
      charts: { fieldShare, programComparison, yearlyCompletion },
      tableRows,
      csvRows: rows
    };
  }

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv(rows) {
    const lines = [HEADERS.map(csvCell).join(',')];
    for (const row of rows) {
      lines.push([row.year, row.id, row.name, row.field, row.region, row.participants, row.completers].map(csvCell).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}`;
  }

  global.ProgramData = { parseCsv, validateRows, buildView, exportCsv };
})(window);
