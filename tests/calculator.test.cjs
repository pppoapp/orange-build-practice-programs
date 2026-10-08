const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/calculator.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/sample-data.js'), 'utf8'), context);
const { parseCsv, validateRows, buildView, exportCsv } = context.window.ProgramData;
const samples = context.window.PROGRAM_SAMPLES;
const plain = value => JSON.parse(JSON.stringify(value));

function parsedSamples() {
  return samples.flatMap(sample => parseCsv(sample.text, sample.name));
}

test('기본 샘플 텍스트가 원본 정상 CSV와 일치한다', () => {
  for (const sample of samples) {
    const source = fs.readFileSync(path.join(root, 'data', 'programs', sample.name), 'utf8');
    assert.equal(sample.text.replace(/\r\n/g, '\n'), source.replace(/\r\n/g, '\n'));
  }
});

test('원본 정상 샘플 3개를 파싱해 기대 합계와 상세 행을 만든다', () => {
  const result = validateRows(parsedSamples());
  assert.equal(result.validRows.length, 18);
  assert.equal(result.rejectedRows.length, 0);
  const view = buildView(result.validRows, ['2024', '2025', '2026']);
  assert.deepEqual(plain(view.summary), {
    participants: 1410,
    completers: 1171,
    completionRate: 1171 / 1410 * 100,
    programCount: 6,
    selectedYearCount: 3,
    cautionCount: 1,
    validRowCount: 18,
    uncalculableCount: 0
  });
  assert.equal(view.tableRows.length, 18);
  assert.equal(view.csvRows.length, 18);
  assert.deepEqual(plain(view.charts.yearlyCompletion.map(item => item.year)), ['2024', '2025', '2026']);
  assert.equal(view.charts.programComparison.length, 6);
});

test('오류 자료는 유효한 첫 중복 행과 0명 행을 보존하고 세 행을 제외한다', () => {
  const parsed = parseCsv('연도,사업ID,사업명,분야,지역,참여자수,수료자수\n2024,X01,중복 사례,교육,서울,20,15\n2024,X01,중복 사례,교육,서울,20,15\n2024,X02,숫자 누락,교육,서울,,15\n2024,X03,0명 사례,교육,서울,0,0\n2024,X04,수료자 초과,교육,서울,10,12\n', 'errors.csv');
  const result = validateRows(parsed);
  assert.equal(result.validRows.length, 2);
  assert.deepEqual(plain(result.rejectedRows.map(item => item.reasonCode)), ['duplicate', 'missing_value', 'completers_exceed_participants']);
  assert.deepEqual(plain(result.rejectedRows.map(item => item.row.line)), [3, 4, 6]);
  const view70 = buildView(result.validRows, ['2024'], 70);
  assert.equal(view70.summary.participants, 20);
  assert.equal(view70.summary.completers, 15);
  assert.equal(view70.summary.completionRate, 75);
  assert.equal(view70.summary.cautionCount, 0);
  assert.equal(view70.tableRows[1].completionRate, null);
  assert.equal(view70.tableRows[1].status, 'uncalculable');
  assert.equal(buildView(result.validRows, ['2024'], 80).tableRows[0].status, 'caution');
});

test('숫자 사유는 누락, 해석 불가, 음수, 소수를 구분한다', () => {
  const csv = [
    '연도,사업ID,사업명,분야,지역,참여자수,수료자수',
    '2024,A,누락,교육,서울,,1',
    '2024,B,문자,교육,서울,열,1',
    '2024,C,음수,교육,서울,-1,0',
    '2024,D,소수,교육,서울,1.5,1',
    '2024,E,유효,교육,서울,2,1'
  ].join('\n');
  const result = validateRows(parseCsv(csv, 'counts.csv'));
  assert.deepEqual(plain(result.rejectedRows.map(item => item.reasonCode)), [
    'missing_value', 'invalid_number', 'negative_count', 'non_integer_count'
  ]);
  assert.equal(result.validRows.length, 1);
});

test('헤더 형식이 다르면 한국어 오류를 던진다', () => {
  assert.throws(() => parseCsv('사업ID,연도,사업명,분야,지역,참여자수,수료자수\n', 'wrong.csv'), /CSV 첫 행은/);
});

test('따옴표·쉼표·개행을 읽고 실제 원본 줄 번호를 보존한다', () => {
  const csv = '연도,사업ID,사업명,분야,지역,참여자수,수료자수\r\n2024,Q1,"이름, ""확장""\r\n과정",교육,서울,4,3\r\n';
  const [row] = parseCsv(csv, 'quoted.csv');
  assert.equal(row.name, '이름, "확장"\r\n과정');
  assert.equal(row.line, 2);
  assert.equal(row.source, 'quoted.csv');
});

test('빈 연도 선택은 모든 집계와 행을 비우고, 0 합계 비율은 null이다', () => {
  const zeroRows = validateRows(parseCsv('연도,사업ID,사업명,분야,지역,참여자수,수료자수\n2024,Z,제로,교육,서울,0,0\n', 'zero.csv')).validRows;
  const empty = buildView(zeroRows, []);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.summary.participants, 0);
  assert.equal(empty.summary.completionRate, null);
  assert.equal(empty.summary.selectedYearCount, 0);
  assert.equal(empty.charts.fieldShare.length, 0);
  const zero = buildView(zeroRows, ['2024']);
  assert.equal(zero.summary.completionRate, null);
  assert.equal(zero.charts.fieldShare[0].share, null);
  assert.equal(zero.charts.yearlyCompletion[0].completionRate, null);
});

test('CSV 내보내기는 원본 7열과 BOM을 쓰며 따옴표 규칙으로 재입력된다', () => {
  const input = '연도,사업ID,사업명,분야,지역,참여자수,수료자수\n2024,R1,"이름, ""인용""\n둘째 줄",교육,서울,3,2\n';
  const [row] = validateRows(parseCsv(input, 'roundtrip.csv')).validRows;
  const exported = exportCsv([row]);
  assert.equal(exported.charCodeAt(0), 0xFEFF);
  const reparsed = parseCsv(exported, 'export.csv');
  assert.equal(reparsed.length, 1);
  for (const key of ['year', 'id', 'name', 'field', 'region', 'participants', 'completers']) {
    assert.equal(reparsed[0][key], row[key]);
  }
  assert.equal(exportCsv([]).replace(/^\uFEFF/, '').split('\r\n').length, 1);
});

test('필터 결과의 분야 색은 다른 연도 선택과 무관하게 같은 키에 고정된다', () => {
  const valid = validateRows(parsedSamples()).validRows;
  const all = buildView(valid, ['2024', '2025', '2026']);
  const one = buildView(valid, ['2026']);
  const allColors = new Map(all.charts.fieldShare.map(item => [item.key, item.color]));
  for (const item of one.charts.fieldShare) assert.equal(item.color, allColors.get(item.key));
});
