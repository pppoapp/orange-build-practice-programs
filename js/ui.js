(function () {
  'use strict';
  const pd = window.ProgramData;
  const $ = (id) => document.getElementById(id);
  const state = { files: null, mainRows: [], rejectedRows: [], allYears: [], selectedYears: [], threshold: 70, view: null, resizeTimer: 0 };
  const colors = ['#78ae2d','#244f38','#d59b42','#7e9fb1','#a2789f','#d27c62','#59a899','#b9a545','#5c76a7','#a9794e'];
  const fieldColors = new Map([['환경','#78ae2d'],['교육','#254f38'],['복지','#d69a3e'],['문화','#7e9fb1'],['지역사회','#a2789f'],['자립','#d27c62'],['기후·환경','#78ae2d'],['환경교육','#86b94a']]);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const number = (value) => Number(value || 0).toLocaleString('ko-KR');
  const pct = (value) => value == null || !Number.isFinite(Number(value)) ? '계산 불가' : `${Number(value).toFixed(1)}%`;
  const safe = (value) => value == null ? '' : String(value);
  const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const svgEl = (tag, attrs, text) => { const el = document.createElementNS(SVG_NS, tag); Object.entries(attrs || {}).forEach(([k,v]) => el.setAttribute(k, String(v))); if (text !== undefined) el.textContent = text; return el; };
  const stableColor = (key, supplied) => {
    if (supplied) return supplied;
    if (fieldColors.has(key)) return fieldColors.get(key);
    let hash = 0; for (let i=0;i<key.length;i++) hash = ((hash << 5)-hash+key.charCodeAt(i))|0;
    return colors[Math.abs(hash)%colors.length];
  };
  const sourceLine = (row) => `${safe(row.source)} · ${row.line == null ? '행 정보 없음' : `${row.line}행`}`;
  function updatePeriod() {
    const label=$('periodLabel');
    if(!label)return;
    label.textContent=state.allYears.length>1?`${state.allYears[0]}—${state.allYears[state.allYears.length-1]}`:(state.allYears[0]||'선택 자료');
  }
  async function readFiles(files) {
    const parsed = await Promise.all(files.map(async file => ({name:file.name, text:await file.text()})));
    const errorFiles = parsed.filter(file => /error|오류/i.test(file.name));
    if (errorFiles.length && errorFiles.length !== parsed.length) {
      $('fileStatus').textContent='정상 자료와 오류 확인 자료는 한 번에 불러올 수 없습니다. 한 종류의 CSV만 선택해 주세요.';
      $('csvFiles').value='';
      return;
    }
    const rows = parsed.flatMap(file => pd.parseCsv(file.text,file.name));
    const main = pd.validateRows(rows);
    state.files = parsed;
    state.mainRows = main.validRows;
    state.rejectedRows = main.rejectedRows;
    state.allYears = [...new Set([...main.validRows,...main.rejectedRows.map(x=>x.row)].map(r=>String(r.year)))].sort((a,b)=>Number(a)-Number(b));
    state.selectedYears = [...state.allYears];
    $('heroSource').textContent = errorFiles.length ? `오류 확인 자료 · ${state.allYears.length}개 연도` : `${files.length}개 CSV 자료 · ${state.allYears.length}개 연도`;
    updatePeriod();
    $('fileStatus').textContent = `${errorFiles.length?'오류 확인 자료를':'자료를'} ${files.length}개 불러왔습니다. ${main.validRows.length}개 유효 행 · ${main.rejectedRows.length}개 제외 행`;
    renderYearOptions(); render();
  }
  function getSamples() {
    const samples = Array.isArray(window.PROGRAM_SAMPLES) ? window.PROGRAM_SAMPLES : [];
    return samples.map(item => ({name:item.name,text:item.text}));
  }
  function restoreSamples() {
    const samples = getSamples();
    if (!samples.length) {
      state.files=[];state.mainRows=[];state.rejectedRows=[];state.allYears=[];state.selectedYears=[];
      $('heroSource').textContent='샘플 자료를 불러오지 못했습니다';$('fileStatus').textContent='PROGRAM_SAMPLES 자료가 없습니다.';
      renderYearOptions();render();return;
    }
    const rows = samples.flatMap(sample => pd.parseCsv(sample.text,sample.name));
    const result = pd.validateRows(rows);
    state.files=samples;state.mainRows=result.validRows;state.rejectedRows=result.rejectedRows;
    state.allYears=[...new Set([...result.validRows,...result.rejectedRows.map(x=>x.row)].map(r=>String(r.year)))].sort((a,b)=>Number(a)-Number(b));
    state.selectedYears=[...state.allYears];
    $('csvFiles').value='';$('heroSource').textContent=`기본 샘플 자료 · ${state.allYears.length}개 연도`;
    updatePeriod();
    $('fileStatus').textContent=`기본 샘플 ${samples.length}개 파일 · ${result.validRows.length}개 유효 행 · ${result.rejectedRows.length}개 제외 행`;
    renderYearOptions();render();
  }
  function renderYearOptions() {
    const root=$('yearOptions');root.replaceChildren();
    if (!state.allYears.length) { root.append(element('span','control-hint','자료에 연도 정보가 없습니다.'));return; }
    state.allYears.forEach(year=>{
      const label=element('label','year-pill');const input=document.createElement('input');input.type='checkbox';input.value=year;input.checked=state.selectedYears.includes(year);input.addEventListener('change',()=>{state.selectedYears=[...root.querySelectorAll('input:checked')].map(x=>x.value);render();});
      label.append(input,document.createTextNode(`${year}년`));root.append(label);
    });
    const actions=element('div','year-actions');const all=element('button','text-button','전체 선택');all.type='button';all.addEventListener('click',()=>{state.selectedYears=[...state.allYears];renderYearOptions();render();});const none=element('button','text-button','전체 해제');none.type='button';none.addEventListener('click',()=>{state.selectedYears=[];renderYearOptions();render();});actions.append(all,none);root.append(actions);
  }
  function renderMetrics(summary) {
    $('metricParticipants').textContent=number(summary.participants);$('metricCompleters').textContent=number(summary.completers);$('metricRate').textContent=pct(summary.completionRate);
    $('metricPrograms').textContent=number(summary.programCount);$('metricYears').textContent=number(summary.selectedYearCount);$('metricCautions').textContent=number(summary.cautionCount);
    $('cautionCaption').textContent=`수료율 ${state.threshold}% 미만 항목`;
  }
  function renderPie(items, total) {
    const host=$('pieChart'), legend=$('pieLegend');host.replaceChildren();legend.replaceChildren();
    const valid=(items||[]).filter(x=>Number(x.participants)>0);const empty=!valid.length||!(Number(total)>0);
    $('pieEmpty').textContent=Number(total)>0?'표시할 참여 실적이 없습니다.':'참여자 합계가 0명이라 비중을 계산할 수 없습니다.';
    $('pieEmpty').hidden=!empty;host.hidden=empty;legend.hidden=empty;if(empty)return;
    const svg=svgEl('svg',{viewBox:'0 0 220 220',class:'chart-svg','aria-hidden':'true'});let angle=-Math.PI/2;const cx=110,cy=110,r=88;
    valid.forEach((item)=>{const amount=Number(item.participants)||0;const sweep=amount/Number(total)*Math.PI*2;const end=angle+sweep;const large=sweep>Math.PI?1:0;const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end);const d=valid.length===1?`M ${cx} ${cy-r} A ${r} ${r} 0 1 1 ${cx-.01} ${cy-r} Z`:`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;svg.append(svgEl('path',{d,fill:stableColor(String(item.key),item.color),stroke:'#fff', 'stroke-width':2}));angle=end;
      const li=element('div','legend-item');const sw=element('i');sw.style.backgroundColor=stableColor(String(item.key),item.color);const title=element('span','',safe(item.key));const share=item.share==null?`${(amount/Number(total)*100).toFixed(1)}%`:pct(item.share);const val=element('b','',`${number(amount)} · ${share}`);li.append(sw,title,val);legend.append(li);
    });host.append(svg);
  }
  function renderBars(items) {
    const host=$('barChart');host.replaceChildren();const rows=items||[];const empty=!rows.length;$('barEmpty').hidden=!empty;host.hidden=empty;if(empty)return;
    const width=Math.max(host.clientWidth||500,600),height=196,left=40,right=10,top=15,bottom=39,plotW=width-left-right,plotH=height-top-bottom;
    const max=Math.max(1,...rows.flatMap(d=>[Number(d.participants)||0,Number(d.completers)||0]));const tick=Math.ceil(max/4/10)*10||1;const ceiling=Math.max(tick,Math.ceil(max/tick)*tick);const svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,class:'chart-svg','aria-hidden':'true'});
    for(let i=0;i<=4;i++){const value=ceiling*i/4,y=top+plotH-(value/ceiling)*plotH;svg.append(svgEl('line',{x1:left,y1:y,x2:width-right,y2:y,class:'gridline'}));svg.append(svgEl('text',{x:left-7,y:y+3,'text-anchor':'end',class:'axis-label'},number(Math.round(value))));}
    const slot=plotW/rows.length,barW=Math.min(20,Math.max(7,slot*.25)),gap=Math.min(5,slot*.08);
    rows.forEach((d,i)=>{const center=left+slot*(i+.5);[[Number(d.participants)||0,'#78ae2d',center-barW-gap/2],[Number(d.completers)||0,'#254f38',center+gap/2]].forEach(([value,color,x])=>{const h=value/ceiling*plotH,y=top+plotH-h;svg.append(svgEl('rect',{x,y,width:barW,height:Math.max(0,h),rx:3,fill:color}));svg.append(svgEl('text',{x:x+barW/2,y:Math.max(10,y-4),'text-anchor':'middle',class:'value-label'},number(value)));});svg.append(svgEl('text',{x:center,y:height-17,'text-anchor':'middle',class:'axis-label'},safe(d.name).length>8?`${safe(d.name).slice(0,7)}…`:safe(d.name)));});host.append(svg);
  }
  function renderLine(items) {
    const host=$('lineChart');host.replaceChildren();const rows=items||[];const empty=!rows.length;$('lineEmpty').hidden=!empty;host.hidden=empty;if(empty)return;
    const width=Math.max(host.clientWidth||700,600),height=220,left=60,right=60,top=28,bottom=48,plotW=width-left-right,plotH=height-top-bottom;const svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,class:'chart-svg','aria-hidden':'true'});const range=[0,25,50,75,100];
    range.forEach(v=>{const y=top+plotH-(v/100)*plotH;svg.append(svgEl('line',{x1:left,y1:y,x2:width-right,y2:y,class:'gridline'}));svg.append(svgEl('text',{x:left-9,y:y+3,'text-anchor':'end',class:'axis-label'},`${v}%`));});
    const points=rows.map((d,i)=>({x:rows.length===1?left+plotW/2:left+i*(plotW/(rows.length-1)),y:d.completionRate==null?null:top+plotH-(Math.min(100,Math.max(0,Number(d.completionRate)))/100)*plotH,row:d}));
    let segment=[];const flush=()=>{if(segment.length>1)svg.append(svgEl('polyline',{points:segment.map(p=>`${p.x},${p.y}`).join(' '),class:'rate-line'}));segment=[];};
    points.forEach(p=>{if(p.y==null){flush();}else segment.push(p);});flush();
    points.forEach(p=>{if(p.y!=null){svg.append(svgEl('circle',{cx:p.x,cy:p.y,r:5,class:'rate-point'}));svg.append(svgEl('text',{x:p.x,y:Math.max(13,p.y-10),'text-anchor':'middle',class:'value-label'},pct(p.row.completionRate)));}else{svg.append(svgEl('text',{x:p.x,y:height-29,'text-anchor':'middle',class:'value-label'},'계산 불가'));}svg.append(svgEl('text',{x:p.x,y:height-10,'text-anchor':'middle',class:'axis-label'},`${safe(p.row.year)}년`));});host.append(svg);
  }
  function renderTable(rows) {
    const body=$('detailRows');body.replaceChildren();const list=rows||[];$('rowCount').textContent=`${number(list.length)}개 실적 행`;$('tableEmpty').hidden=!!list.length;
    list.forEach(row=>{const tr=document.createElement('tr');const vals=[row.year,row.id,row.name,row.field,row.region,number(row.participants),number(row.completers),pct(row.completionRate)];vals.forEach((v,i)=>{const td=document.createElement('td');td.textContent=safe(v);if(i>=5&&i<=7)td.className='number';tr.append(td);});const statusTd=document.createElement('td');const badge=element('span',`status-badge ${row.status||'uncalculable'}`,row.status==='caution'?'기준 미달':row.status==='ok'?'양호':'계산 불가');statusTd.append(badge);tr.append(statusTd);const source=element('td','source-cell',safe(row.source));source.title=safe(row.source);tr.append(source);const line=element('td','',row.line==null?'—':`${row.line}행`);tr.append(line);body.append(tr);});
  }
  function renderRejected() {
    const list=$('rejectedList');list.replaceChildren();const rows=state.rejectedRows;$('rejectedCount').textContent=`${number(rows.length)}건 제외`;$('rejectedEmpty').hidden=!!rows.length;
    rows.forEach(item=>{const row=item.row||{};const card=element('div','rejected-item');card.append(element('span','rejected-source',sourceLine(row)));card.append(element('span','rejected-record',`${safe(row.year)} · ${safe(row.id)} ${safe(row.name)}`));card.append(element('span','rejected-reason',safe(item.reason)));list.append(card);});
  }
  function render() {
    if(!pd||typeof pd.buildView!=='function')return;
    state.threshold=Number($('threshold').value);if(!Number.isFinite(state.threshold)||state.threshold<0||state.threshold>100){$('threshold').setAttribute('aria-invalid','true');return;}$('threshold').removeAttribute('aria-invalid');
    const view=pd.buildView(state.mainRows,state.selectedYears,state.threshold);state.view=view;renderMetrics(view.summary);renderPie(view.charts.fieldShare,view.summary.participants);renderBars(view.charts.programComparison);renderLine(view.charts.yearlyCompletion);renderTable(view.tableRows);renderRejected();
  }
  $('csvFiles').addEventListener('change',async event=>{const files=[...event.target.files];if(!files.length)return;try{await readFiles(files);}catch(error){$('fileStatus').textContent=`자료를 읽지 못했습니다: ${error.message||error}`;}});
  $('restoreButton').addEventListener('click',restoreSamples);
  $('threshold').addEventListener('input',render);
  $('downloadButton').addEventListener('click',()=>{if(!state.view)return;const csv=pd.exportCsv(state.view.csvRows);const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='사업실적_통합.csv';document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);});
  window.addEventListener('resize',()=>{window.clearTimeout(state.resizeTimer);state.resizeTimer=window.setTimeout(()=>{if(state.view){renderBars(state.view.charts.programComparison);renderLine(state.view.charts.yearlyCompletion);}},100);});
  restoreSamples();
})();
