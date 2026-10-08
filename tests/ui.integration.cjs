// Lightweight DOM contract checks. These do not replace browser layout inspection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.clientWidth = 700; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelectorAll(selector) { const out = []; const visit = e => { for (const child of e.children || []) { if (selector === 'input:checked' && child.tagName === 'input' && child.checked) out.push(child); visit(child); } }; visit(this); return out; }
  remove() {}
  click() { this.clicked = true; }
  async fire(type) { for (const fn of this.listeners[type] || []) await fn({ target: this }); }
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
elements.get('threshold').value = '70';
const document = { getElementById(id) { assert(elements.has(id), `Missing HTML id: ${id}`); return elements.get(id); }, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: text => ({ textContent: text }), body: new Element('body') };
let downloaded;
const window = { addEventListener() {}, clearTimeout() {}, setTimeout(fn) { fn(); return 1; } };
const context = vm.createContext({ window, document, Blob: class { constructor(parts) { downloaded = parts.join(''); } }, URL: { createObjectURL: () => 'blob:local-test', revokeObjectURL() {} }, console });
for (const file of ['sample-data.js', 'calculator.js', 'ui.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: file });
const get = id => elements.get(id);
function assertChartHosts() { for (const id of ['pieChart', 'barChart', 'lineChart']) assert.equal(get(id).children[0].tagName, 'svg', `${id} creates SVG`); }
(async () => {
  assert.equal(get('metricParticipants').textContent, '1,410');
  assert.equal(get('metricCompleters').textContent, '1,171');
  assert.equal(get('metricPrograms').textContent, '6');
  assert.equal(get('metricYears').textContent, '3');
  assert.equal(get('metricCautions').textContent, '1');
  assert.equal(get('detailRows').children.length, 18);
  assertChartHosts();
  const inputs = get('yearOptions').querySelectorAll('input:checked');
  for (const input of inputs) input.checked = input.value === '2024';
  await inputs[0].fire('change');
  assert.equal(get('metricParticipants').textContent, '400');
  assert.equal(get('metricCompleters').textContent, '320');
  assert.equal(get('detailRows').children.length, 6);
  await get('downloadButton').fire('click');
  assert.equal(window.ProgramData.parseCsv(downloaded, 'download.csv').length, 6);
  for (const input of inputs) input.checked = false;
  await inputs[0].fire('change');
  assert.equal(get('metricYears').textContent, '0');
  assert.equal(get('detailRows').children.length, 0);
  assert.equal(get('metricRate').textContent, '계산 불가');
  await get('restoreButton').fire('click');
  get('threshold').value = '80'; await get('threshold').fire('input');
  assert.equal(get('metricCautions').textContent, '8');
  get('threshold').value = '70'; await get('threshold').fire('input');
  const text = fs.readFileSync(path.join(root, 'data/programs/errors.csv'), 'utf8');
  get('csvFiles').files = [{ name: 'errors.csv', text: async () => text }];
  await get('csvFiles').fire('change');
  assert.equal(get('metricParticipants').textContent, '20');
  assert.equal(get('metricCompleters').textContent, '15');
  assert.equal(get('detailRows').children.length, 2);
  assert.equal(get('rejectedList').children.length, 3);
  await get('downloadButton').fire('click');
  assert.equal(window.ProgramData.parseCsv(downloaded, 'error-export.csv').length, 2);
  await get('restoreButton').fire('click');
  assert.equal(get('detailRows').children.length, 18);
  console.log('PASS: default metrics/SVG/table, year filtering, empty selection, CSV download, threshold, error upload, restore. Layout is not checked by this test.');
})().catch(error => { console.error(error); process.exitCode = 1; });
