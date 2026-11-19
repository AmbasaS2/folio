import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'missing source: ' + start);
  return source.slice(a, b);
}
const tagCode = section('function getTagFlowLineMap(meta) {', '// Run a single animation frame again');
const frameCode = section('function runCardTagLayout(expectedRoot = rootElement) {', 'function disconnectTagLayoutObserver() {');

function buildMock(width, tagWidths) {
  class HTMLElement {
    constructor() { this.hidden = false; this.textContent = ''; this.dataset = {}; this.attributes = {}; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    removeAttribute(key) { delete this.attributes[key]; }
  }
  const name = new HTMLElement(); name.width = 4;
  const tags = tagWidths.map((tagWidth, idx) => {
    const tag = new HTMLElement(); tag.width = tagWidth; tag.textContent = 'tag' + idx;
    return tag;
  });
  const overflow = new HTMLElement(); overflow.isOverflow = true;
  const meta = new HTMLElement();
  const card = new HTMLElement(); card.isConnected = true;
  const tagList = new HTMLElement();

  function visible() {
    return [name, ...tags, overflow].filter(el => !el.hidden);
  }
  function boxFor(target) {
    let x = 0, line = 0;
    for (const el of visible()) {
      const w = el.isOverflow ? Math.max(2, String(el.textContent).length + 1) : el.width;
      if (x > 0 && x + w > width) { x = 0; line += 1; }
      if (el === target) return { left: x, top: line * 16, width: w, height: 10 };
      x += w;
    }
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  meta.getBoundingClientRect = () => ({ width });
  for (const el of [name, ...tags, overflow]) el.getBoundingClientRect = () => boxFor(el);
  meta.querySelector = selector => selector === '.folio-character-name' ? name : null;
  meta.querySelectorAll = selector => selector === '.folio-card-tag:not([hidden])'
    ? [...tags, overflow].filter(el => !el.hidden) : [];
  tagList.querySelectorAll = selector => selector === '.folio-card-tag:not(.folio-card-tag-overflow)' ? tags : [];
  card.querySelector = selector => ({
    '.folio-card-meta': meta,
    '.folio-card-tags': tagList,
    '.folio-card-tag-overflow': overflow,
  })[selector] || null;
  return { HTMLElement, card, tags, overflow };
}

const legacyLayoutCode = [
  'function referenceLegacy(card) {',
  '  const meta = card.querySelector(".folio-card-meta");',
  '  const tagList = card.querySelector(".folio-card-tags");',
  '  const overflowBadge = card.querySelector(".folio-card-tag-overflow");',
  '  const badges = Array.from(tagList.querySelectorAll(".folio-card-tag:not(.folio-card-tag-overflow)"));',
  '  for (const badge of badges) badge.hidden = false;',
  '  overflowBadge.hidden = true;',
  '  overflowBadge.textContent = "";',
  '  const initialLineMap = getTagFlowLineMap(meta);',
  '  let visibleCount = badges.findIndex(badge => (initialLineMap.get(badge) ?? Infinity) >= 2);',
  '  if (visibleCount < 0) visibleCount = badges.length;',
  '  if (visibleCount === badges.length) return visibleCount;',
  '  for (let i = visibleCount; i < badges.length; i++) badges[i].hidden = true;',
  '  overflowBadge.hidden = false;',
  '  while (true) {',
  '    overflowBadge.textContent = "+" + (badges.length - visibleCount);',
  '    if (getTagFlowLineIndex(meta, overflowBadge) < 2 || visibleCount === 0) break;',
  '    visibleCount--; badges[visibleCount].hidden = true;',
  '  }',
  '  return visibleCount;',
  '}',
].join('\n');

function layoutInVM(ui) {
  const sandbox = {
    HTMLElement: ui.HTMLElement,
    tr: (key, count) => 'hidden ' + count,
  };
  vm.createContext(sandbox);
  vm.runInContext(tagCode + legacyLayoutCode +
    '\nglobalThis.api = { layoutCardTagOverflow, referenceLegacy };', sandbox);
  return sandbox.api;
}

test('new logarithmic layout matches legacy visible tags and overflow count on varied widths', () => {
  for (const width of [10, 13, 16, 18, 22, 25, 29]) {
    for (let seed = 0; seed < 30; seed++) {
      const count = 1 + seed;
      const widths = Array.from({ length: count }, (_, i) => 2 + ((seed * 11 + i * 7) % 7));
      const before = buildMock(width, widths);
      const after = buildMock(width, widths);
      const legacyApi = layoutInVM(before);
      const improvedApi = layoutInVM(after);
      const expected = legacyApi.referenceLegacy(before.card);
      assert.equal(improvedApi.layoutCardTagOverflow(after.card), true);
      const actual = after.tags.filter(tag => !tag.hidden).length;
      assert.equal(actual, expected, 'different visible badge count; width=' + width + ' seed=' + seed);
      assert.equal(after.card.dataset.hiddenTagCount, String(widths.length - expected));
    }
  }
});

test('all cards finish in one scheduled frame, not after multi-second staggered frames', () => {
  class HTMLElement {}
  const cards = Array.from({ length: 35 }, (_, id) => ({ id }));
  const root = Object.assign(new HTMLElement(), {
    isConnected: true,
    querySelectorAll: () => cards,
  });
  const scheduled = new Map();
  const processed = [];
  let id = 0;
  const sandbox = {
    HTMLElement,
    rootElement: root,
    runtimeRevision: 1,
    tagLayoutFrame: null,
    layoutCardTagOverflow: card => processed.push(card.id),
    isRuntimeCurrent: revision => revision === 1,
    requestAnimationFrame: callback => { scheduled.set(++id, callback); return id; },
    cancelAnimationFrame: n => scheduled.delete(n),
  };
  vm.createContext(sandbox);
  vm.runInContext(frameCode + '\nglobalThis.api = { scheduleCardTagLayout };', sandbox);
  sandbox.api.scheduleCardTagLayout(root);
  assert.equal(processed.length, 0);
  assert.equal(scheduled.size, 1);
  const fn = scheduled.values().next().value;
  scheduled.clear(); fn();
  assert.equal(processed.length, 35);
  assert.equal(scheduled.size, 0);
});

test('aborted lifecycle cannot execute stale tag layout work', () => {
  assert.match(frameCode, /isRuntimeCurrent\(operationRevision\)/);
  assert.match(frameCode, /cancelScheduledCardTagLayout\(\)/);
  assert.doesNotMatch(frameCode, /FOLIO_TAG_LAYOUT_FRAME_LIMIT/);
});

test('no card data, portrait, chat list, notes or pin functions are changed', () => {
  assert.match(source, /function renderCharacterGrid\(/);
  assert.match(source, /function observePortrait\(/);
  assert.match(source, /function renderChatRows\(/);
  assert.match(source, /function getStoredNotes\(/);
  assert.match(source, /function savePinnedChatIds\(/);
});
