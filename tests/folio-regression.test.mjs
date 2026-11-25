import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const settingsHtml = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const base = 'http://folio.test';
const modulePath = '/scripts/extensions/third-party/folio/index.js';
const stub = [
    "export const default_avatar = '/avatar/default.png';",
    "export const formatCharacterAvatar = name => '/avatar/' + encodeURIComponent(name);",
    "export const saveSettings = async () => window.host.stats.saves++;",
    "export const setActiveCharacter = avatar => window.host.stats.active.push(avatar);",
    "export const deleteCharacterChatByName = async (...args) => window.host.stats.deletes.push(args);",
    "export const renameGroupOrCharacterChat = async (...args) => window.host.stats.renames.push(args);",
    "export const updateRemoteChatName = async (...args) => window.host.stats.remoteRenames.push(args);",
].join('\n');

let browser;
test.before(async () => {
    browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    });
});
test.after(async () => { await browser?.close(); });

async function fixture({ width = 1000, count = 37, settings = {}, defer = false } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: width < 608 });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUZsAAAAASUVORK5CYII=', 'base64');
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        const files = {
            '/': ['text/html', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="chat"><div class="welcomePanel"><div class="welcomeShortcuts"><button id="native-shortcut">Native shortcut</button></div></div></main><aside id="extensions_settings2"></aside></body></html>'],
            '/style.css': ['text/css', css],
            [modulePath]: ['text/javascript', source],
            '/script.js': ['text/javascript', stub],
        };
        if (files[url.pathname]) {
            const [contentType, body] = files[url.pathname];
            return route.fulfill({ contentType, body });
        }
        if (url.pathname.startsWith('/avatar/') || url.pathname.startsWith('/thumbnail')) {
            return route.fulfill({ contentType: 'image/png', body: pixel });
        }
        return route.abort();
    });
    await page.goto(base);
    await page.evaluate(({ count, settings, defer, settingsHtml }) => {
        const stats = { requests: [], saves: 0, selections: [], opened: [], active: [], commands: [], deletes: [], renames: [], remoteRenames: [], observers: [] };
        const eventNames = ['APP_READY', 'EXTENSION_SETTINGS_LOADED', 'CHARACTER_RENAMED', 'CHARACTER_DELETED', 'CHAT_CHANGED'];
        const bindings = new Map(eventNames.map(name => [name, new Set()]));
        const characters = Array.from({ length: count }, (_, i) => ({
            avatar: 'char' + i + '.png', name: 'Character ' + i, date_last_chat: 1700000000 + i,
        }));
        const tags = [{ id: 'even', name: 'Even' }, { id: 'rare', name: 'Rare' }, ...Array.from({length: 15}, (_, i) => ({ id: 'long' + i, name: 'Long tag ' + i }))];
        const tagMap = Object.fromEntries(characters.map((c, i) => [c.avatar, [
            ...(i % 2 === 0 ? ['even'] : []), ...(i % 5 === 0 ? ['rare'] : []),
            ...(i === 0 ? tags.slice(2).map(t => t.id) : []),
        ]]));
        let chatId = 'Initial';
        const ctx = {
            characters, tags, tagMap, characterId: 0,
            extensionSettings: { characterFolio: { sortMode: 'name-asc', desktopColumns: 4, mobileColumns: 2, portraitRows: 3, chatPageSize: 5, ...settings }, unrelated: { keep: true } },
            eventTypes: Object.fromEntries(eventNames.map(name => [name, name])),
            eventSource: {
                on(name, handler) { bindings.get(name)?.add(handler); },
                off(name, handler) { bindings.get(name)?.delete(handler); },
            },
            renderExtensionTemplateAsync: async () => settingsHtml,
            getRequestHeaders: () => ({'Content-Type':'application/json'}),
            getThumbnailUrl: (_type, name) => '/thumbnail?file=' + encodeURIComponent(name),
            saveSettingsDebounced: () => stats.saves++,
            getCurrentChatId: () => chatId,
            selectCharacterById: async id => { stats.selections.push(id); if (!window.host.refuseSelection) ctx.characterId = id; },
            openCharacterChat: async id => { stats.opened.push(id); chatId = id; },
            executeSlashCommandsWithOptions: async command => stats.commands.push(command),
        };
        window.SillyTavern = { getContext: () => ctx };
        const host = window.host = {
            ctx, stats, bindings, defer, refuseSelection: false,
            emit(name, ...args) { for (const fn of [...bindings.get(name) || []]) fn(...args); },
            listenerCount() { return [...bindings.values()].reduce((n, group) => n + group.size, 0); },
            activeObservers() { return stats.observers.filter(record => record.active).map(record => record.kind); },
            chats(avatar) {
                return Array.from({length: 13}, (_, i) => ({file_id: avatar.replace('.png','') + ' Chat ' + (i + 1) + '.jsonl'}));
            },
        };
        // Wrap actual browser observers, not their callbacks: DOM timing and
        // observation behavior stay native, while tests can count ownership.
        for (const kind of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
            const Native = window[kind];
            window[kind] = class extends Native {
                constructor(callback, options) {
                    super(callback, options);
                    this.record = {kind, active:false, targets:new Set(), stack:new Error().stack};
                    // Playwright also creates a document observer in its injected
                    // script. Count only observers constructed by Folio's module.
                    if (this.record.stack.includes('/third-party/folio/index.js:')) stats.observers.push(this.record);
                }
                observe(target, options) {
                    super.observe(target, options);
                    this.record.targets.add(target);
                    this.record.active = true;
                }
                unobserve(target) {
                    super.unobserve(target);
                    this.record.targets.delete(target);
                    this.record.active = this.record.targets.size > 0;
                }
                disconnect() {
                    super.disconnect();
                    this.record.targets.clear();
                    this.record.active = false;
                }
            };
        }
        // Keep the transport hermetic, even if a future build adds another
        // endpoint. Deferred replies deliberately ignore abort so the stale
        // request guard is tested independently of network cancellation.
        const pending = [];
        host.pending = pending;
        host.resolve = (index, data, ok = true) => pending[index].resolve({ok, status: ok ? 200 : 500, statusText: ok ? 'OK' : 'Error', json: async () => data});
        window.fetch = (path, options = {}) => {
            const body = JSON.parse(options.body || '{}');
            stats.requests.push({path: String(path), method: options.method, body});
            if (path !== '/api/characters/chats' || options.method !== 'POST' || body.simple !== true) {
                throw new Error('Unexpected request: ' + path);
            }
            if (!host.defer) return Promise.resolve({ok:true,json:async()=>host.chats(body.avatar_url)});
            return new Promise(resolve => pending.push({resolve, signal:options.signal, avatar:body.avatar_url}));
        };
    }, { count, settings, defer, settingsHtml });
    await page.evaluate(async path => {
        window.folio = await import(path);
        window.folio.onActivate();
    }, modulePath);
    await page.waitForSelector('#character-folio-root');
    await page.waitForSelector('#folio-settings', {state:'attached'});
    const cards = () => page.locator('.folio-card').evaluateAll(nodes => nodes.map(node => node.dataset.avatar));
    const requests = () => page.evaluate(() => host.stats.requests);
    const select = async avatar => page.locator('.folio-card[data-avatar="' + avatar + '"] .folio-character-name').click();
    const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const close = async () => {
        try { assert.deepEqual(errors, []); } finally { await page.close(); }
    };
    return {page,cards,requests,select,tick,close};
}

test('welcome shelf reads only loaded metadata; repeated host events keep existing shelf and observers', async () => {
    const f = await fixture({count:240});
    try {
        assert.equal((await f.cards()).length, 12);
        assert.deepEqual(await f.requests(), []);
        assert.equal(await f.page.evaluate(()=>host.stats.saves), 0);
        const before = await f.page.locator('#character-folio-root').elementHandle();
        const observers = await f.page.evaluate(()=>host.stats.observers.length);
        await f.page.evaluate(()=>{
            for(let i=0;i<5;i++){folio.onActivate();host.emit('APP_READY');host.emit('CHAT_CHANGED');}
        });
        await f.tick();
        assert.equal(await before.evaluate(node=>node.isConnected),true);
        assert.equal(await f.page.evaluate(()=>host.stats.observers.length),observers);
        assert.equal(await f.page.locator('#character-folio-root').count(),1);
        assert.deepEqual(await f.requests(),[]);
        assert.equal(await f.page.locator('#folio-welcome-shortcuts-host #native-shortcut').count(),1);
    } finally { await f.close(); }
});

for (const width of [390,1000]) test('character pagination, search, pin ordering and resize: '+width+'px', async () => {
    const f = await fixture({width,settings:{pinnedAvatars:['char23.png','char31.png']}});
    try {
        const expected=width<608?6:12;
        assert.equal((await f.cards()).length,expected);
        assert.deepEqual((await f.cards()).slice(0,2),['char23.png','char31.png']);
        const next=f.page.locator('.folio-character-pager button').last();
        await next.click();
        assert.equal((await f.cards()).includes('char23.png'),false);
        const input=f.page.locator('.folio-search');
        const node=await input.elementHandle();
        await input.fill('Character 36');
        assert.deepEqual(await f.cards(),['char36.png']);
        assert.equal(await node.evaluate(el=>el.isConnected),true);
        assert.equal(await f.page.locator('.folio-character-pager').isVisible(),false);
        await input.fill('');
        assert.equal((await f.cards()).length,expected);
        await f.page.setViewportSize({width:width<608?1000:390,height:850});
        await f.page.waitForFunction(n=>document.querySelectorAll('.folio-card').length===n,width<608?12:6);
        assert.deepEqual(await f.requests(),[]);
        assert.equal(await f.page.evaluate(()=>host.stats.saves),0);
    } finally { await f.close(); }
});

test('tag filter uses AND; name and tag filtering do not fetch chats', async () => {
    const f=await fixture();
    try {
        await f.page.locator('.folio-tag-filter').click();
        await f.page.getByRole('menuitemcheckbox',{name:'Even',exact:true}).click();
        await f.page.getByRole('menuitemcheckbox',{name:'Rare',exact:true}).click();
        assert.deepEqual(await f.cards(),['char0.png','char10.png','char20.png','char30.png']);
        await f.page.keyboard.press('Escape');
        await f.page.locator('.folio-search').fill('Character 2');
        assert.deepEqual(await f.cards(),['char20.png']);
        assert.deepEqual(await f.requests(),[]);
    } finally { await f.close(); }
});

test('character pin and memo persist without replacing an unchanged card on note save',async()=>{
    const f=await fixture();
    try {
        const target=f.page.locator('.folio-card[data-avatar="char3.png"]');
        await target.locator('.folio-card-open').click({button:'right'});
        await f.page.getByText('Pin to top',{exact:true}).click();
        assert.equal((await f.cards())[0],'char3.png');
        assert.deepEqual(await f.page.evaluate(()=>host.ctx.extensionSettings.characterFolio.pinnedAvatars),['char3.png']);
        const card=await target.elementHandle();
        await target.locator('.folio-memo-edit').click();
        await f.page.locator('.folio-memo-input').fill('A note for this character');
        await f.page.locator('.folio-memo-editor button[type="submit"]').click();
        assert.equal(await target.locator('.folio-memo').textContent(),'A note for this character');
        assert.equal(await card.evaluate(node=>node.isConnected),true);
        assert.equal(await f.page.evaluate(()=>host.ctx.extensionSettings.characterFolio.notesByAvatar['char3.png']),'A note for this character');
        assert.deepEqual(await f.requests(),[]);
    } finally { await f.close(); }
});

test('only chosen character filenames requested; chat search, pinned order and paging remain local',async()=>{
    const f=await fixture({settings:{pinnedChatsByAvatar:{'char1.png':['char1 Chat 3']}}});
    try{
        await f.select('char1.png');
        await f.page.waitForSelector('.folio-chat-row');
        assert.deepEqual(await f.requests(),[{path:'/api/characters/chats',method:'POST',body:{avatar_url:'char1.png',simple:true}}]);
        assert.equal(await f.page.locator('.folio-chat-row').count(),5);
        assert.equal(await f.page.locator('.folio-chat-title').first().textContent(),'char1 Chat 3');
        await f.page.locator('.folio-chat-pager button').last().click();
        assert.equal(await f.page.locator('.folio-chat-pager .folio-page-status').textContent(),'2 / 3');
        const input=f.page.locator('.folio-chat-search'), node=await input.elementHandle();
        await input.fill('Chat 12');
        assert.deepEqual(await f.page.locator('.folio-chat-title').allTextContents(),['char1 Chat 12']);
        assert.equal(await node.evaluate(el=>el.isConnected),true);
        assert.equal((await f.requests()).length,1);
        await f.page.locator('.folio-chat-row').click();
        await f.page.waitForFunction(()=>host.stats.opened.length===1);
        assert.deepEqual(await f.page.evaluate(()=>({selections:host.stats.selections,opened:host.stats.opened})),{selections:[1],opened:['char1 Chat 12']});
        assert.equal(await f.page.locator('#character-folio-overlay').isVisible(),false);
    }finally{await f.close();}
});

test('late A response cannot overwrite B drawer even when transport ignores abort',async()=>{
    const f=await fixture({defer:true});
    try{
        // Invoke production click handlers directly while the drawer is open
        // to simulate rapid/reentrant selection without bypassing the handler.
        await f.select('char1.png');
        await f.page.waitForFunction(()=>host.pending.length===1);
        await f.page.locator('.folio-card[data-avatar="char2.png"] .folio-character-name').evaluate(node=>node.click());
        await f.page.waitForFunction(()=>host.pending.length===2);
        assert.equal(await f.page.evaluate(()=>host.pending[0].signal.aborted),true);
        await f.page.evaluate(()=>host.resolve(1,[{file_id:'B only.jsonl'}]));
        await f.page.waitForSelector('.folio-chat-row');
        await f.page.evaluate(()=>host.resolve(0,[{file_id:'A stale.jsonl'}]));
        await f.tick();
        assert.deepEqual(await f.page.locator('.folio-chat-title').allTextContents(),['B only']);
        assert.equal(await f.page.locator('#folio-drawer-title').textContent(),'Character 2');
    }finally{await f.close();}
});

test('closing drawer aborts request; late reply cannot reopen or populate it',async()=>{
    const f=await fixture({defer:true});
    try{
        await f.select('char0.png');
        await f.page.waitForFunction(()=>host.pending.length===1);
        await f.page.locator('.folio-close').click();
        assert.equal(await f.page.evaluate(()=>host.pending[0].signal.aborted),true);
        await f.page.evaluate(()=>host.resolve(0,[{file_id:'Late.jsonl'}]));
        await f.tick();
        assert.equal(await f.page.locator('#character-folio-overlay').isVisible(),false);
        assert.equal(await f.page.locator('.folio-chat-row').count(),0);
    }finally{await f.close();}
});

test('empty/duplicate filenames normalize; title filtering never reads contents',async()=>{
    const f=await fixture({defer:true});
    try{
        await f.select('char0.png');
        await f.page.waitForFunction(()=>host.pending.length===1);
        await f.page.evaluate(()=>host.resolve(0,[' Alpha.jsonl','Alpha.jsonl',{file_name:'Beta.JSONL',messages:['ignored']},null,{},'']));
        await f.page.waitForSelector('.folio-chat-row');
        assert.deepEqual(await f.page.locator('.folio-chat-title').allTextContents(),['Beta','Alpha']);
        await f.page.locator('.folio-chat-search').fill('not found');
        assert.equal(await f.page.locator('.folio-chat-row').count(),0);
        assert.equal((await f.requests()).length,1);
    }finally{await f.close();}
});

test('disable aborts pending list, disconnects observers and restores shortcuts; re-enable binds once',async()=>{
    const f=await fixture({defer:true});
    try{
        const originalCount=await f.page.evaluate(()=>host.listenerCount());
        assert.ok(originalCount>0);
        assert.equal(await f.page.evaluate(()=>host.activeObservers().filter(k=>k==='MutationObserver').length),1);
        assert.ok(await f.page.evaluate(()=>host.activeObservers().includes('ResizeObserver')));
        await f.select('char0.png');
        await f.page.waitForFunction(()=>host.pending.length===1);
        await f.page.evaluate(()=>folio.onDisable());
        assert.equal(await f.page.evaluate(()=>host.pending[0].signal.aborted),true);
        assert.deepEqual(await f.page.evaluate(()=>host.activeObservers()),[]);
        assert.equal(await f.page.evaluate(()=>host.listenerCount()),0);
        assert.equal(await f.page.locator('#character-folio-root').count(),0);
        assert.equal(await f.page.locator('#character-folio-overlay').count(),0);
        assert.equal(await f.page.locator('.welcomePanel .welcomeShortcuts #native-shortcut').count(),1);
        await f.page.evaluate(()=>host.resolve(0,[{file_id:'Late.jsonl'}]));
        await f.tick();
        await f.page.evaluate(()=>{folio.onEnable();folio.onEnable();});
        await f.page.waitForSelector('#character-folio-root');
        await f.tick();
        assert.equal(await f.page.evaluate(()=>host.listenerCount()),originalCount);
        assert.equal(await f.page.locator('#character-folio-root').count(),1);
        assert.equal(await f.page.locator('.folio-chat-row').count(),0);
        assert.equal((await f.requests()).length,1);
        assert.equal(await f.page.evaluate(()=>host.activeObservers().filter(k=>k==='MutationObserver').length),1);
    }finally{await f.close();}
});

test('height-only viewport changes do not rebuild cards; tag overflow is bounded',async()=>{
    const f=await fixture({width:390});
    try{
        const node=await f.page.locator('.folio-card[data-avatar="char0.png"]').elementHandle();
        await f.page.waitForFunction(()=>Number(document.querySelector('.folio-card[data-avatar="char0.png"]').dataset.hiddenTagCount)>0);
        const rows=await f.page.locator('.folio-card[data-avatar="char0.png"] .folio-card-meta').evaluate(meta=>{
            const elements=[meta.querySelector('.folio-character-name'),...meta.querySelectorAll('.folio-card-tag:not([hidden])')];
            const centers=[];
            for(const el of elements){
                const r=el.getBoundingClientRect();
                if(r.width&&r.height&&!centers.some(y=>Math.abs(y-(r.top+r.height/2))<=2))centers.push(r.top+r.height/2);
            }
            return centers.length;
        });
        assert.ok(rows<=2,'name and tag overflow must fit the two-line contract');
        const count=await f.page.evaluate(()=>host.stats.observers.length);
        await f.page.setViewportSize({width:390,height:500});
        await f.tick();
        assert.equal(await node.evaluate(el=>el.isConnected),true);
        assert.equal(await f.page.evaluate(()=>host.stats.observers.length),count);
        assert.deepEqual(await f.requests(),[]);
    }finally{await f.close();}
});

test('native welcome replacement retires old drawer and its in-flight request',async()=>{
    const f=await fixture({defer:true});
    try{
        await f.select('char0.png');
        await f.page.waitForFunction(()=>host.pending.length===1);
        const old=await f.page.locator('#character-folio-root').elementHandle();
        await f.page.evaluate(()=>{
            const next=document.createElement('div');
            next.className='welcomePanel';
            next.innerHTML='<div class="welcomeShortcuts"><button id="new-shortcut">New shortcut</button></div>';
            document.getElementById('chat').replaceChildren(next);
        });
        await f.page.waitForFunction(()=>document.querySelector('#folio-welcome-shortcuts-host #new-shortcut'));
        assert.equal(await old.evaluate(el=>el.isConnected),false);
        assert.equal(await f.page.evaluate(()=>host.pending[0].signal.aborted),true);
        await f.page.evaluate(()=>host.resolve(0,[{file_id:'Old welcome response.jsonl'}]));
        await f.tick();
        assert.equal(await f.page.locator('#character-folio-overlay').isVisible(),false);
        assert.equal(await f.page.locator('.folio-chat-row').count(),0);
        assert.equal(await f.page.locator('#character-folio-root').count(),1);
        assert.equal(await f.page.evaluate(()=>host.activeObservers().filter(k=>k==='MutationObserver').length),1);
    }finally{await f.close();}
});

test('refused host character switch cannot open a filename on the wrong character',async()=>{
    const f=await fixture();
    try{
        await f.select('char1.png');
        await f.page.waitForSelector('.folio-chat-row');
        await f.page.evaluate(()=>host.refuseSelection=true);
        await f.page.locator('.folio-chat-row').first().click();
        await f.page.waitForSelector('.folio-state.is-error');
        assert.deepEqual(await f.page.evaluate(()=>({selections:host.stats.selections,opened:host.stats.opened,active:host.stats.active})),{selections:[1],opened:[],active:[]});
        assert.equal(await f.page.evaluate(()=>host.ctx.characterId),0);
        assert.equal((await f.requests()).length,1);
    }finally{await f.close();}
});

test('enabled preference removes shelf observers and restores them without duplicate event bindings',async()=>{
    const f=await fixture();
    try{
        const count=await f.page.evaluate(()=>host.listenerCount());
        await f.page.locator('#folio-enabled').uncheck();
        assert.equal(await f.page.locator('#character-folio-root').count(),0);
        assert.deepEqual(await f.page.evaluate(()=>host.activeObservers()),[]);
        assert.equal(await f.page.evaluate(()=>host.ctx.extensionSettings.characterFolio.enabled),false);
        assert.deepEqual(await f.page.evaluate(()=>host.ctx.extensionSettings.unrelated),{keep:true});
        await f.page.locator('#folio-enabled').check();
        await f.page.waitForSelector('#character-folio-root');
        assert.equal(await f.page.evaluate(()=>host.listenerCount()),count);
        assert.equal(await f.page.evaluate(()=>host.activeObservers().filter(k=>k==='MutationObserver').length),1);
        assert.deepEqual(await f.requests(),[]);
    }finally{await f.close();}
});
