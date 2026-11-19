import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8');
const start = source.indexOf('const FOLIO_TAG_LAYOUT_FRAME_BUDGET_MS = 6;');
const end = source.indexOf('function disconnectTagLayoutObserver() {', start);
assert.ok(start >= 0 && end > start, 'Tag layout scheduler not found');
const schedulerSource = source.slice(start, end);

function fixture(count = 11, costPerCard = 0) {
    class HTMLElement {}
    const cards = Array.from({ length: count }, (_, i) => Object.assign(new HTMLElement(), { id: i, isConnected: true }));
    const root = Object.assign(new HTMLElement(), {
        isConnected: true,
        querySelectorAll(selector) {
            assert.equal(selector, '.folio-card[data-has-tags="true"]');
            return cards;
        },
        contains(element) { return cards.includes(element); },
    });
    const frames = new Map();
    const processed = [];
    let nextFrame = 0;
    let elapsed = 0;
    const sandbox = {
        HTMLElement,
        rootElement: root,
        runtimeRevision: 1,
        isRuntimeCurrent(revision) { return revision === this.runtimeRevision; },
        tagLayoutFrame: null,
        layoutCardTagOverflow(card) { processed.push(card.id); elapsed += costPerCard; },
        performance: { now: () => elapsed },
        requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
        clearTimeout(id) { frames.delete(id); },
    };
    // Avoid depending on caller binding of a context method.
    sandbox.isRuntimeCurrent = revision => revision === sandbox.runtimeRevision;
    vm.createContext(sandbox);
    vm.runInContext(schedulerSource + '\nglobalThis.folioTestApi = { scheduleCardTagLayout, cancelScheduledCardTagLayout };', sandbox);
    const step = () => {
        const [id, callback] = frames.entries().next().value || [];
        if (callback) { frames.delete(id); callback(); }
    };
    const flush = () => {
        let iterations = 0;
        while (frames.size) { assert.ok(++iterations < 30, 'Runaway animation frames'); step(); }
    };
    return { sandbox, cards, root, frames, processed, step, flush };
}

test('tag layout is deferred and limited to four cards per frame', () => {
    const f = fixture(11);
    f.sandbox.folioTestApi.scheduleCardTagLayout(f.root);
    assert.deepEqual(f.processed, []);
    f.step();
    assert.deepEqual(f.processed, [0, 1, 2, 3]);
    f.step();
    assert.deepEqual(f.processed, [0, 1, 2, 3, 4, 5, 6, 7]);
    f.flush();
    assert.deepEqual(f.processed, Array.from({ length: 11 }, (_, i) => i));
});

test('frame budget stops after one costly card even under four-card cap', () => {
    const f = fixture(5, 7);
    f.sandbox.folioTestApi.scheduleCardTagLayout(f.root);
    f.step();
    assert.deepEqual(f.processed, [0]);
    f.flush();
    assert.equal(f.processed.length, 5);
});

test('reschedule cancels in-progress layout and prevents duplicated page work', () => {
    const f = fixture(10);
    f.sandbox.folioTestApi.scheduleCardTagLayout(f.root);
    f.step();
    assert.equal(f.processed.length, 4);
    // A filter/page redraw schedules a new current snapshot.
    f.sandbox.folioTestApi.scheduleCardTagLayout(f.root);
    assert.equal(f.frames.size, 1);
    f.flush();
    assert.deepEqual(f.processed.slice(4), Array.from({ length: 10 }, (_, i) => i));
});

test('detached roots and stale lifecycle revisions do not mutate UI', () => {
    const detached = fixture(9);
    detached.sandbox.folioTestApi.scheduleCardTagLayout(detached.root);
    detached.root.isConnected = false;
    detached.flush();
    assert.equal(detached.processed.length, 0);

    const stale = fixture(9);
    stale.sandbox.folioTestApi.scheduleCardTagLayout(stale.root);
    stale.sandbox.runtimeRevision = 2;
    stale.flush();
    assert.equal(stale.processed.length, 0);
});

test('a page without tag badges schedules no work', () => {
    const f = fixture(0);
    f.sandbox.folioTestApi.scheduleCardTagLayout(f.root);
    assert.equal(f.frames.size, 0);
});

test('full original tag-overflow implementation and pagination remain intact', () => {
    assert.match(source, /function layoutCardTagOverflow\(card\)/);
    assert.match(source, /function getTagFlowLineMap\(meta\)/);
    assert.match(source, /function getTagFlowLineIndex\(meta, target\)/);
    assert.match(source, /function renderCharacterGrid\(/);
    assert.match(source, /function observePortrait\(/);
    assert.match(source, /function renderChatRows\(/);
    assert.match(schedulerSource, /layoutCardTagOverflow\(card\)/);
    assert.match(schedulerSource, /cancelScheduledCardTagLayout\(\);/);
});
