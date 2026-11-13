import {
    default_avatar,
    deleteCharacterChatByName,
    formatCharacterAvatar,
    renameGroupOrCharacterChat,
    saveSettings,
    setActiveCharacter,
    updateRemoteChatName,
} from '../../../../script.js';

/*
 * Folio v1.4.0
 * A lightweight, character-first doorway to existing SillyTavern chats.
 *
 * Performance contract:
 * - The welcome view only uses SillyTavern's already-loaded character array.
 * - Chat filenames are requested only after an explicit character click.
 * - Chat JSONL contents, previews, statistics, sizes, and timestamps are never read here.
 */

const MODULE_NAME = 'characterFolio';
const ROOT_ID = 'character-folio-root';
const OVERLAY_ID = 'character-folio-overlay';
const SETTINGS_ID = 'folio-settings';
const SHORTCUTS_HOST_ID = 'folio-welcome-shortcuts-host';
function resolveExtensionPath(moduleUrl = import.meta.url) {
    try {
        const pathname = decodeURIComponent(new URL(moduleUrl).pathname);
        const marker = '/scripts/extensions/';
        const markerIndex = pathname.lastIndexOf(marker);
        if (markerIndex >= 0) {
            const relativePath = pathname.slice(markerIndex + marker.length);
            const fileSeparator = relativePath.lastIndexOf('/');
            if (fileSeparator > 0) return relativePath.slice(0, fileSeparator);
        }
    } catch {
        // Keep a stable fallback for non-browser test harnesses and unusual hosts.
    }
    return 'third-party/folio';
}
const EXTENSION_PATH = resolveExtensionPath();
const NOTE_LIMIT = 100;
const CHAT_LIST_ENDPOINT = '/api/characters/chats';
const LONG_PRESS_DELAY = 550;
const LONG_PRESS_DISTANCE = 10;
const PORTRAIT_SCALES = Object.freeze([50, 60, 70, 80, 90, 100, 110, 120]);
const DESKTOP_COLUMN_COUNTS = Object.freeze([2, 3, 4, 5, 6, 7]);
const MOBILE_COLUMN_COUNTS = Object.freeze([1, 2, 3, 4, 5]);
const CHARACTER_PAGE_SIZES = Object.freeze([3, 4, 6, 8, 9, 12, 15, 16]);
const FONT_SCALES = Object.freeze([80, 90, 100, 110, 120, 130, 140, 150]);
const CHAT_PAGE_SIZES = Object.freeze([5, 10, 15, 20]);
const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    imageQuality: 'high',
    portraitScale: 100, // Retained as legacy setting data for safe rollback; no longer controls layout.
    portraitRatio: 'portrait',
    desktopColumns: 3,
    mobileColumns: 3,
    characterPageSize: 12,
    fontScale: 100,
    cornerStyle: 'round',
    chatPageSize: 10,
});
const SETTING_OPTIONS = Object.freeze({
    enabled: new Set([true, false]),
    imageQuality: new Set(['low', 'high']),
    portraitScale: new Set(PORTRAIT_SCALES),
    portraitRatio: new Set(['portrait', 'square']),
    desktopColumns: new Set(DESKTOP_COLUMN_COUNTS),
    mobileColumns: new Set(MOBILE_COLUMN_COUNTS),
    characterPageSize: new Set(CHARACTER_PAGE_SIZES),
    fontScale: new Set(FONT_SCALES),
    cornerStyle: new Set(['sharp', 'round']),
    chatPageSize: new Set(CHAT_PAGE_SIZES),
});
const SELECT_SETTING_CONTROLS = Object.freeze([
    { id: 'folio-image-quality', key: 'imageQuality' },
    { id: 'folio-portrait-ratio', key: 'portraitRatio' },
    { id: 'folio-desktop-columns', key: 'desktopColumns' },
    { id: 'folio-mobile-columns', key: 'mobileColumns' },
    { id: 'folio-corner-style', key: 'cornerStyle' },
]);
const RANGE_SETTING_CONTROLS = Object.freeze([
    { id: 'folio-character-page-size', key: 'characterPageSize', values: CHARACTER_PAGE_SIZES, unit: 'count', indexed: true },
    { id: 'folio-chat-page-size', key: 'chatPageSize', values: CHAT_PAGE_SIZES, unit: 'count' },
    { id: 'folio-font-scale', key: 'fontScale', values: FONT_SCALES, unit: '%', live: true },
]);
const DEFAULT_SORT_MODE = 'recent';
const SORT_OPTIONS = Object.freeze([
    { value: 'recent', label: 'Recently chatted' },
    { value: 'name-asc', label: 'Name (A–Z)' },
    { value: 'name-desc', label: 'Name (Z–A)' },
    { value: 'chat-size-desc', label: 'Most chat data' },
    { value: 'random', label: 'Random order' },
]);
const SORT_MODE_VALUES = new Set(SORT_OPTIONS.map(option => option.value));
const DEFAULT_CHAT_SORT_MODE = 'title-desc';
const CHAT_SORT_OPTIONS = Object.freeze([
    { value: 'title-desc', label: 'Title (Z–A)' },
    { value: 'title-asc', label: 'Title (A–Z)' },
]);
const CHAT_SORT_MODE_VALUES = new Set(CHAT_SORT_OPTIONS.map(option => option.value));
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

let lifecycleEnabled = true;
let initialized = false;
let folioRuntimeActive = false;
let runtimeRevision = 0;
let chatObserver = null;
let portraitObserver = null;
let tagLayoutObserver = null;
let tagLayoutObservedGrid = null;
let tagLayoutObservedWidth = null;
let tagLayoutFrame = null;
let tagLayoutResizeHandler = null;
let tagLayoutFontReadyRoot = null;
let domReadyHandler = null;
let hostEventBindings = [];
let runtimeEventBindings = [];
let rootElement = null;
let overlayElement = null;
let drawerElement = null;
let settingsElement = null;
let settingsMountPromise = null;
let shortcutsHostElement = null;
let shortcutsElement = null;
let shortcutsOriginalParent = null;
let shortcutsOriginalNextSibling = null;
let activeMenuElement = null;
let activeMenuCleanup = null;
let activeListController = null;
let activeListSequence = 0;
let activeDrawerAvatar = '';
let currentSearch = '';
const currentTagIds = new Set();
let currentCharacterPage = 1;
let currentChatPage = 1;
let currentChatSearch = '';
let currentSortMode = DEFAULT_SORT_MODE;
let currentChatSortMode = DEFAULT_CHAT_SORT_MODE;
let activeChatState = null;
let lastFocusedElement = null;
let openingChat = false;
let deletingChat = false;
let renamingChat = false;
let cleaningFolioData = false;
let lifecycleRevision = 0;
let pendingCharacterRefresh = false;
let enabledSaveQueue = null;
const sessionRecentByAvatar = new Map();
const randomOrderByAvatar = new Map();

function context() {
    if (!globalThis.SillyTavern?.getContext) {
        throw new Error('SillyTavern.getContext() is unavailable.');
    }
    return globalThis.SillyTavern.getContext();
}

function safeContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

const UI_ENGLISH = Object.freeze({
  "sort.recent": "Recently chatted",
  "sort.name-asc": "Name (A–Z)",
  "sort.name-desc": "Name (Z–A)",
  "sort.chat-size-desc": "Most chat data",
  "sort.random": "Random order",
  "chatSort.title-desc": "Title (Z–A)",
  "chatSort.title-asc": "Title (A–Z)",
  "character.unnamed": "Unnamed character",
  "filter.tags": "Tags",
  "filter.all": "All",
  "filter.selected": "Character tags: {0} selected",
  "filter.allSelected": "Character tags: all",
  "menu.default": "Menu",
  "page.previous": "{0}: previous page",
  "page.next": "{0}: next page",
  "page.characters": "Characters",
  "page.chats": "Chats",
  "card.openChats": "Open {0}'s chats",
  "card.pinMenu": "Pin menu for {0}",
  "card.unpin": "Unpin",
  "card.pin": "Pin to top",
  "card.tags": "Tags for {0}",
  "card.editNote": "Edit note for {0}",
  "card.hiddenTags": "{0} hidden tags: {1}",
  "empty.searchCharacters": "No matching characters.",
  "empty.characters": "No characters to display.",
  "shortcuts.label": "SillyTavern shortcuts",
  "sort.characterLabel": "Folio character sort order",
  "sort.searchPlaceholder": "Search",
  "sort.searchLabel": "Search character names",
  "filter.tagLabel": "Filter character tags",
  "filter.tagMenu": "Select character tags",
  "page.characterLabel": "Character pages",
  "settings.cleanupTitle": "Clear Folio's saved data?",
  "settings.cleanupMessage": "Settings, sorting preferences, pins, and notes will be deleted and reset to defaults. Characters and chats will not be deleted.",
  "drawer.sortLabel": "Sort chats for {0}",
  "drawer.close": "Close",
  "search.chats": "Search chat titles",
  "empty.chats": "No saved chats yet.",
  "empty.chatSearch": "No matching chat titles.",
  "chat.open": "Open {0}. Long-press for actions{1}",
  "chat.pinnedSuffix": ". Pinned",
  "chat.menu": "Chat menu for {0}",
  "chat.rename": "Rename",
  "chat.delete": "Delete",
  "chat.deleteLabel": "Delete {0}",
  "chat.deleteTitle": "Delete chat",
  "chat.newChat": "Start new chat",
  "chat.pin": "Pin chat",
  "chat.unpin": "Unpin chat",
  "chat.pageLabel": "Chat pages",
  "delete.title": "Delete this chat?",
  "delete.message": "“{0}” cannot be recovered after deletion.",
  "delete.fallback": "Delete “{0}”?\nThis cannot be undone.",
  "rename.title": "Rename chat",
  "rename.prompt": "Enter a new chat title.",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "rename.unavailable": "Cannot rename this chat.",
  "rename.empty": "Enter at least one character for the chat name.",
  "rename.duplicate": "A chat with this name already exists.",
  "error.characterMissing": "Character not found.",
  "error.rename": "Could not rename the chat.",
  "error.delete": "Could not delete the chat.",
  "error.loadChats": "Could not load chats.",
  "error.startChat": "Could not start a new chat.",
  "error.openChat": "Could not open the chat.",
  "loading.chats": "Loading chats…",
  "memo.title": "{0} · note",
  "memo.placeholder": "A short note about this character",
  "memo.label": "Note for {0}, up to {1} characters",
  "settings.enabled": "Enable Folio",
  "settings.quality": "Portrait quality",
  "settings.qualityLow": "Low-resolution thumbnail",
  "settings.qualityHigh": "High-resolution original",
  "settings.ratio": "Portrait ratio",
  "settings.ratioPortrait": "Portrait (2:3)",
  "settings.ratioSquare": "Square (1:1)",
  "settings.columns": "Portraits per row",
  "settings.desktop": "Desktop",
  "settings.mobile": "Mobile devices",
  "unit.count": "{0} items",
  "settings.characterPage": "Portraits per page",
  "settings.chatPage": "Chats per page",
  "settings.font": "Font size",
  "settings.corner": "Corners",
  "settings.cornerSharp": "Sharp",
  "settings.cornerRound": "Rounded",
  "settings.clean": "Clean up saved data"
});
function tr(key, ...values) {
    const fallback = UI_ENGLISH[key] ?? key;
    let translated = fallback;
    try {
        translated = safeContext()?.translate?.(fallback, 'folio.' + key) || fallback;
    } catch {
        // English fallback when the host has no locale translator.
    }
    return String(translated).replace(/\{(\d+)\}/g, (token, index) => String(values[Number(index)] ?? token));
}

function uiSortLabel(mode) {
    return tr('sort.' + mode);
}

function uiChatSortLabel(mode) {
    return tr('chatSort.' + mode);
}

function translateSettingsText(container) {
    if (!(container instanceof HTMLElement)) return;
    for (const element of container.querySelectorAll('[data-folio-i18n]')) {
        element.textContent = tr(element.getAttribute('data-folio-i18n'));
    }
    for (const option of container.querySelectorAll('[data-folio-count]')) {
        option.textContent = tr('unit.count', Number(option.getAttribute('data-folio-count')));
    }
}

function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function getCharacterName(character) {
    return String(character?.name || character?.data?.name || tr('character.unnamed')).trim();
}

function getAvatarKey(character) {
    return typeof character?.avatar === 'string' ? character.avatar : '';
}

function getCharacterInitial(character) {
    return Array.from(getCharacterName(character))[0] || '?';
}

function parseTimestamp(value) {
    if (value === null || value === undefined || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseChatSize(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function compareByRecent(left, right) {
    const leftAvatar = getAvatarKey(left.character);
    const rightAvatar = getAvatarKey(right.character);
    const leftSession = sessionRecentByAvatar.get(leftAvatar) || 0;
    const rightSession = sessionRecentByAvatar.get(rightAvatar) || 0;
    if (leftSession !== rightSession) return rightSession - leftSession;

    const leftLastChat = parseTimestamp(left.character?.date_last_chat);
    const rightLastChat = parseTimestamp(right.character?.date_last_chat);
    if (leftLastChat !== rightLastChat) return rightLastChat - leftLastChat;

    return collator.compare(getCharacterName(left.character), getCharacterName(right.character));
}

function shuffleCharacterOrder(contextValue = safeContext()) {
    const avatars = Array.isArray(contextValue?.characters)
        ? contextValue.characters.map(getAvatarKey).filter(Boolean)
        : [];
    for (let i = avatars.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [avatars[i], avatars[j]] = [avatars[j], avatars[i]];
    }
    if (avatars.length > 1 && avatars.every((avatar, index) => randomOrderByAvatar.get(avatar) === index)) {
        avatars.push(avatars.shift());
    }
    randomOrderByAvatar.clear();
    avatars.forEach((avatar, rank) => randomOrderByAvatar.set(avatar, rank));
}

function ensureRandomCharacterOrder(contextValue = safeContext()) {
    const characters = contextValue?.characters;
    if (!Array.isArray(characters)) return;
    if (!randomOrderByAvatar.size) {
        shuffleCharacterOrder(contextValue);
        return;
    }
    for (const character of characters) {
        const avatar = getAvatarKey(character);
        if (avatar && !randomOrderByAvatar.has(avatar)) randomOrderByAvatar.set(avatar, randomOrderByAvatar.size);
    }
}

function compareCharacterRecords(left, right, sortMode = currentSortMode) {
    const nameComparison = collator.compare(getCharacterName(left.character), getCharacterName(right.character));
    if (sortMode === 'random') {
        return (randomOrderByAvatar.get(getAvatarKey(left.character)) ?? Number.MAX_SAFE_INTEGER)
            - (randomOrderByAvatar.get(getAvatarKey(right.character)) ?? Number.MAX_SAFE_INTEGER) || nameComparison;
    }
    if (sortMode === 'name-asc') return nameComparison;
    if (sortMode === 'name-desc') return -nameComparison;
    if (sortMode === 'chat-size-desc') {
        const sizeComparison = parseChatSize(right.character?.chat_size) - parseChatSize(left.character?.chat_size);
        return sizeComparison || compareByRecent(left, right);
    }
    return compareByRecent(left, right);
}

function getCharactersForDisplay(contextValue = safeContext(), sortMode = currentSortMode) {
    const characters = contextValue?.characters;
    if (!Array.isArray(characters)) return [];
    if (sortMode === 'random') ensureRandomCharacterOrder(contextValue);

    const sorted = characters
        .map((character, characterId) => ({ character, characterId }))
        .filter(({ character }) => character && getAvatarKey(character))
        .sort((left, right) => compareCharacterRecords(left, right, sortMode));
    const pinned = getStoredPinnedAvatars(contextValue);
    if (!pinned.length) return sorted;

    const pinnedOrder = new Map(pinned.map((avatar, index) => [avatar, index]));
    const pinnedRecords = [];
    const unpinnedRecords = [];
    for (const record of sorted) {
        if (pinnedOrder.has(getAvatarKey(record.character))) pinnedRecords.push(record);
        else unpinnedRecords.push(record);
    }
    pinnedRecords.sort((left, right) => (
        pinnedOrder.get(getAvatarKey(left.character)) - pinnedOrder.get(getAvatarKey(right.character))
    ));
    return [...pinnedRecords, ...unpinnedRecords];
}

function getAvailableTags(contextValue = safeContext()) {
    const tags = Array.isArray(contextValue?.tags) ? contextValue.tags : [];
    return tags
        .filter(tag => tag && tag.id !== undefined && String(tag.name || '').trim())
        .map(tag => ({ id: String(tag.id), name: String(tag.name).trim() }))
        .sort((left, right) => collator.compare(left.name, right.name));
}

function getCharacterTags(character, contextValue = safeContext(), availableTags = getAvailableTags(contextValue)) {
    const tagMap = contextValue?.tagMap;
    const assigned = tagMap && typeof tagMap === 'object' ? tagMap[getAvatarKey(character)] : null;
    if (!Array.isArray(assigned) || assigned.length === 0) return [];

    const assignedIds = new Set(assigned.map(value => String(value)));
    const seen = new Set();
    return availableTags.filter(tag => {
        if (!assignedIds.has(tag.id) || seen.has(tag.id)) return false;
        seen.add(tag.id);
        return true;
    });
}

function characterMatchesSelectedTags(character, selectedTagIds = currentTagIds, contextValue = safeContext()) {
    if (!(selectedTagIds instanceof Set) || selectedTagIds.size === 0) return true;
    const tagMap = contextValue?.tagMap;
    const assigned = tagMap && typeof tagMap === 'object' ? tagMap[getAvatarKey(character)] : null;
    if (!Array.isArray(assigned)) return false;
    const assignedTagIds = new Set(assigned.map(value => String(value)));
    return Array.from(selectedTagIds).every(tagId => assignedTagIds.has(String(tagId)));
}

function updateTagFilterControl(contextValue = safeContext(), expectedRoot = rootElement) {
    if (!(expectedRoot instanceof HTMLElement)) return;
    const label = expectedRoot.querySelector('.folio-tag-filter-label');
    const button = expectedRoot.querySelector('.folio-tag-filter');
    if (!(label instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return;

    const selectedNames = getAvailableTags(contextValue)
        .filter(tag => currentTagIds.has(tag.id))
        .map(tag => tag.name);
    const selectedCount = selectedNames.length;
    label.textContent = selectedNames.length ? selectedNames.join(', ') : tr('filter.tags');
    button.title = selectedNames.length ? selectedNames.join(', ') : tr('filter.all');
    button.setAttribute(
        'aria-label',
        selectedCount ? tr('filter.selected', selectedCount) : tr('filter.allSelected'),
    );
}

function getStoredSortMode(contextValue = safeContext()) {
    const value = contextValue?.extensionSettings?.[MODULE_NAME]?.sortMode;
    return SORT_MODE_VALUES.has(value) ? value : DEFAULT_SORT_MODE;
}

function getStoredChatSortMode(contextValue = safeContext()) {
    const value = contextValue?.extensionSettings?.[MODULE_NAME]?.chatSortMode;
    return CHAT_SORT_MODE_VALUES.has(value) ? value : DEFAULT_CHAT_SORT_MODE;
}

function getStoredNotes(contextValue = safeContext()) {
    const notes = contextValue?.extensionSettings?.[MODULE_NAME]?.notesByAvatar;
    if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return null;
    return notes;
}

function getStoredNote(avatar, notes = getStoredNotes()) {
    const value = notes?.[avatar];
    return typeof value === 'string' ? value : '';
}

function trimNote(value) {
    return Array.from(String(value || '').trim()).slice(0, NOTE_LIMIT).join('');
}

function ensureModuleSettings(contextValue) {
    if (
        !contextValue.extensionSettings[MODULE_NAME] ||
        typeof contextValue.extensionSettings[MODULE_NAME] !== 'object' ||
        Array.isArray(contextValue.extensionSettings[MODULE_NAME])
    ) {
        contextValue.extensionSettings[MODULE_NAME] = {};
    }
    return contextValue.extensionSettings[MODULE_NAME];
}

function normalizeSettingValue(key, rawValue) {
    const options = SETTING_OPTIONS[key];
    if (!options) return DEFAULT_SETTINGS[key];
    if (key === 'portraitScale' || key === 'desktopColumns' || key === 'mobileColumns' || key === 'characterPageSize' || key === 'fontScale' || key === 'chatPageSize') {
        const numeric = Number(rawValue);
        return options.has(numeric) ? numeric : DEFAULT_SETTINGS[key];
    }
    return options.has(rawValue) ? rawValue : DEFAULT_SETTINGS[key];
}

function getFolioSettings(contextValue = safeContext()) {
    const stored = contextValue?.extensionSettings?.[MODULE_NAME];
    return {
        enabled: normalizeSettingValue('enabled', stored?.enabled),
        imageQuality: normalizeSettingValue('imageQuality', stored?.imageQuality),
        portraitScale: normalizeSettingValue('portraitScale', stored?.portraitScale),
        portraitRatio: normalizeSettingValue('portraitRatio', stored?.portraitRatio),
        desktopColumns: normalizeSettingValue('desktopColumns', stored?.desktopColumns),
        mobileColumns: normalizeSettingValue('mobileColumns', stored?.mobileColumns),
        characterPageSize: normalizeSettingValue('characterPageSize', stored?.characterPageSize),
        fontScale: normalizeSettingValue('fontScale', stored?.fontScale),
        cornerStyle: normalizeSettingValue('cornerStyle', stored?.cornerStyle),
        chatPageSize: normalizeSettingValue('chatPageSize', stored?.chatPageSize),
    };
}

function isRuntimeCurrent(revision = runtimeRevision) {
    return lifecycleEnabled && folioRuntimeActive && revision === runtimeRevision;
}

function saveEnabledPreferenceImmediately() {
    const execute = async () => {
        try {
            await saveSettings();
        } catch (error) {
            console.error('[Folio] Failed to save the enabled preference:', error);
        }
    };
    const queued = enabledSaveQueue ? enabledSaveQueue.then(execute, execute) : execute();
    const tracked = queued.finally(() => {
        if (enabledSaveQueue === tracked) enabledSaveQueue = null;
    });
    enabledSaveQueue = tracked;
    return tracked;
}

function savePreference(key, rawValue) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return false;
    const nextValue = normalizeSettingValue(key, rawValue);
    const ctx = context();
    const currentValue = getFolioSettings(ctx)[key];
    if (nextValue === currentValue) return false;

    if (nextValue === DEFAULT_SETTINGS[key]) {
        const moduleSettings = ctx.extensionSettings?.[MODULE_NAME];
        if (moduleSettings && typeof moduleSettings === 'object' && !Array.isArray(moduleSettings)) {
            delete moduleSettings[key];
            cleanEmptySettings(ctx);
        }
    } else {
        ensureModuleSettings(ctx)[key] = nextValue;
    }

    handlePreferenceChange(key);
    if (key === 'enabled') {
        void saveEnabledPreferenceImmediately();
    } else {
        ctx.saveSettingsDebounced?.();
    }
    return true;
}

function getPinnedChatIds(avatar, contextValue = safeContext()) {
    const value = contextValue?.extensionSettings?.[MODULE_NAME]?.pinnedChatsByAvatar?.[avatar];
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter(id => typeof id === 'string' && id)));
}

function savePinnedChatIds(avatar, ids) {
    if (!avatar) return;
    const ctx = context();
    const next = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id)));
    const moduleSettings = ctx.extensionSettings?.[MODULE_NAME];
    if (next.length) {
        const settings = ensureModuleSettings(ctx);
        if (!settings.pinnedChatsByAvatar || typeof settings.pinnedChatsByAvatar !== 'object' ||
            Array.isArray(settings.pinnedChatsByAvatar)) settings.pinnedChatsByAvatar = {};
        settings.pinnedChatsByAvatar[avatar] = next;
    } else if (moduleSettings?.pinnedChatsByAvatar && typeof moduleSettings.pinnedChatsByAvatar === 'object') {
        delete moduleSettings.pinnedChatsByAvatar[avatar];
        if (!Object.keys(moduleSettings.pinnedChatsByAvatar).length) delete moduleSettings.pinnedChatsByAvatar;
        cleanEmptySettings(ctx);
    } else return;
    ctx.saveSettingsDebounced?.();
}

function togglePinnedChat(avatar, fileId) {
    if (!avatar || !fileId) return;
    const pinned = getPinnedChatIds(avatar);
    const index = pinned.indexOf(fileId);
    if (index < 0) pinned.push(fileId);
    else pinned.splice(index, 1);
    savePinnedChatIds(avatar, pinned);
    const state = activeChatState;
    if (state?.body?.isConnected && getAvatarKey(state.character) === avatar) {
        currentChatPage = 1;
        renderChatRows(state.body, state.character, state.chats);
    }
}

function migratePinnedChatId(avatar, oldFileId, newFileId) {
    if (!avatar || !oldFileId || !newFileId || oldFileId === newFileId) return;
    const pinned = getPinnedChatIds(avatar);
    const index = pinned.indexOf(oldFileId);
    if (index < 0) return;
    if (pinned.includes(newFileId)) pinned.splice(index, 1);
    else pinned[index] = newFileId;
    savePinnedChatIds(avatar, pinned);
}

function removePinnedChatId(avatar, fileId) {
    const pinned = getPinnedChatIds(avatar);
    if (pinned.includes(fileId)) savePinnedChatIds(avatar, pinned.filter(id => id !== fileId));
}

function migratePinnedChatsForAvatar(oldAvatar, newAvatar) {
    if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return;
    const previous = getPinnedChatIds(oldAvatar);
    if (!previous.length) return;
    savePinnedChatIds(newAvatar, [...getPinnedChatIds(newAvatar), ...previous]);
    savePinnedChatIds(oldAvatar, []);
}

function deletePinnedChatsForAvatar(avatar) {
    if (avatar) savePinnedChatIds(avatar, []);
}

function getStoredPinnedAvatars(contextValue = safeContext()) {
    const value = contextValue?.extensionSettings?.[MODULE_NAME]?.pinnedAvatars;
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter(avatar => typeof avatar === 'string' && avatar && !seen.has(avatar) && seen.add(avatar));
}

function savePinnedAvatars(avatars) {
    const ctx = context();
    const normalized = Array.from(new Set((Array.isArray(avatars) ? avatars : []).filter(value => typeof value === 'string' && value)));
    if (normalized.length) {
        ensureModuleSettings(ctx).pinnedAvatars = normalized;
    } else {
        const moduleSettings = ctx.extensionSettings?.[MODULE_NAME];
        if (moduleSettings && typeof moduleSettings === 'object' && !Array.isArray(moduleSettings)) {
            delete moduleSettings.pinnedAvatars;
            cleanEmptySettings(ctx);
        }
    }
    ctx.saveSettingsDebounced?.();
}

function isAvatarPinned(avatar, contextValue = safeContext()) {
    return getStoredPinnedAvatars(contextValue).includes(avatar);
}

function togglePinnedAvatar(avatar) {
    if (!avatar) return;
    const pinned = getStoredPinnedAvatars();
    const index = pinned.indexOf(avatar);
    if (index >= 0) pinned.splice(index, 1);
    else pinned.push(avatar);
    savePinnedAvatars(pinned);
    currentCharacterPage = 1;
    renderCharacterGrid();
}

function cleanEmptySettings(contextValue) {
    const moduleSettings = contextValue?.extensionSettings?.[MODULE_NAME];
    if (!moduleSettings || typeof moduleSettings !== 'object' || Array.isArray(moduleSettings)) return;

    const notes = moduleSettings.notesByAvatar;
    if (notes && typeof notes === 'object' && !Array.isArray(notes) && Object.keys(notes).length === 0) {
        delete moduleSettings.notesByAvatar;
    }
    if (Object.keys(moduleSettings).length === 0) {
        delete contextValue.extensionSettings[MODULE_NAME];
    }
}

async function clearStoredFolioData(contextValue = context(), shouldContinue = null) {
    const extensionSettings = contextValue?.extensionSettings;
    if (!extensionSettings || typeof extensionSettings !== 'object') return false;

    if (enabledSaveQueue) await enabledSaveQueue;
    if (typeof shouldContinue === 'function' && !shouldContinue()) return null;
    if (!Object.hasOwn(extensionSettings, MODULE_NAME)) return false;
    delete extensionSettings[MODULE_NAME];
    await saveSettings();
    return true;
}

function saveNote(avatar, rawValue) {
    if (!avatar) return false;
    const ctx = context();
    const nextValue = trimNote(rawValue);
    const previousValue = getStoredNote(avatar);
    if (nextValue === previousValue) return false;

    if (nextValue) {
        const moduleSettings = ensureModuleSettings(ctx);
        if (!moduleSettings.notesByAvatar || typeof moduleSettings.notesByAvatar !== 'object' || Array.isArray(moduleSettings.notesByAvatar)) {
            moduleSettings.notesByAvatar = {};
        }
        moduleSettings.notesByAvatar[avatar] = nextValue;
    } else {
        const notes = getStoredNotes();
        if (!notes || !Object.hasOwn(notes, avatar)) return false;
        delete notes[avatar];
        cleanEmptySettings(ctx);
    }

    ctx.saveSettingsDebounced?.();
    updateVisibleNote(avatar, nextValue);
    return true;
}

function saveSortMode(sortMode) {
    if (!SORT_MODE_VALUES.has(sortMode)) return false;
    if (sortMode === 'random') shuffleCharacterOrder();
    if (sortMode === currentSortMode && sortMode !== 'random') return false;
    const ctx = context();
    currentSortMode = sortMode;

    if (sortMode === DEFAULT_SORT_MODE) {
        const moduleSettings = ctx.extensionSettings?.[MODULE_NAME];
        if (moduleSettings && typeof moduleSettings === 'object' && !Array.isArray(moduleSettings)) {
            delete moduleSettings.sortMode;
            cleanEmptySettings(ctx);
        }
    } else {
        ensureModuleSettings(ctx).sortMode = sortMode;
    }

    ctx.saveSettingsDebounced?.();
    currentCharacterPage = 1;
    renderCharacterGrid();
    return true;
}

function saveChatSortMode(sortMode) {
    if (!CHAT_SORT_MODE_VALUES.has(sortMode) || sortMode === currentChatSortMode) return false;
    const ctx = context();
    currentChatSortMode = sortMode;

    if (sortMode === DEFAULT_CHAT_SORT_MODE) {
        const moduleSettings = ctx.extensionSettings?.[MODULE_NAME];
        if (moduleSettings && typeof moduleSettings === 'object' && !Array.isArray(moduleSettings)) {
            delete moduleSettings.chatSortMode;
            cleanEmptySettings(ctx);
        }
    } else {
        ensureModuleSettings(ctx).chatSortMode = sortMode;
    }

    ctx.saveSettingsDebounced?.();
    currentChatPage = 1;
    return true;
}

function migrateNote(oldAvatar, newAvatar) {
    if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return;
    const ctx = safeContext();
    const notes = getStoredNotes();
    if (!ctx || !notes || !Object.hasOwn(notes, oldAvatar)) return;

    if (!getStoredNote(newAvatar, notes)) notes[newAvatar] = notes[oldAvatar];
    delete notes[oldAvatar];
    cleanEmptySettings(ctx);
    ctx.saveSettingsDebounced?.();
}

function deleteNoteForAvatar(avatar) {
    if (!avatar) return;
    const ctx = safeContext();
    const notes = getStoredNotes();
    if (!ctx || !notes || !Object.hasOwn(notes, avatar)) return;

    delete notes[avatar];
    cleanEmptySettings(ctx);
    ctx.saveSettingsDebounced?.();
}

function migratePinnedAvatar(oldAvatar, newAvatar) {
    if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return;
    const pinned = getStoredPinnedAvatars();
    const oldIndex = pinned.indexOf(oldAvatar);
    if (oldIndex < 0) return;
    if (pinned.includes(newAvatar)) pinned.splice(oldIndex, 1);
    else pinned[oldIndex] = newAvatar;
    savePinnedAvatars(pinned);
}

function deletePinnedAvatar(avatar) {
    if (!avatar) return;
    const pinned = getStoredPinnedAvatars();
    const next = pinned.filter(value => value !== avatar);
    if (next.length !== pinned.length) savePinnedAvatars(next);
}

function getThumbnailUrl(character, contextValue = safeContext()) {
    const avatar = getAvatarKey(character);
    if (!avatar || avatar === 'none') return default_avatar;
    if (typeof contextValue?.getThumbnailUrl === 'function') {
        return contextValue.getThumbnailUrl('avatar', avatar);
    }
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`;
}

function getOriginalAvatarUrl(character) {
    const avatar = getAvatarKey(character);
    return !avatar || avatar === 'none' ? default_avatar : formatCharacterAvatar(avatar);
}

function getPortraitUrl(character, contextValue = safeContext()) {
    return getFolioSettings(contextValue).imageQuality === 'low'
        ? getThumbnailUrl(character, contextValue)
        : getOriginalAvatarUrl(character);
}

function findDirectWelcomePanel(chatElement = document.getElementById('chat')) {
    if (!chatElement) return null;
    return Array.from(chatElement.children).find(
        child => child instanceof HTMLElement && child.classList.contains('welcomePanel'),
    ) || null;
}

function scrollFolioToTopInsideChat(expectedRoot = rootElement) {
    if (
        !(expectedRoot instanceof HTMLElement)
        || !expectedRoot.isConnected
        || rootElement !== expectedRoot
    ) return false;
    const chatElement = expectedRoot.parentElement;
    if (!(chatElement instanceof HTMLElement) || chatElement.id !== 'chat') return false;

    const chatRect = chatElement.getBoundingClientRect();
    const rootRect = expectedRoot.getBoundingClientRect();
    const targetScrollTop = (Number(chatElement.scrollTop) || 0)
        + rootRect.top
        - chatRect.top
        - (Number(chatElement.clientTop) || 0);
    if (!Number.isFinite(targetScrollTop)) return false;

    chatElement.scrollTop = Math.max(0, targetScrollTop);
    return true;
}

function disconnectPortraitObserver() {
    portraitObserver?.disconnect();
    portraitObserver = null;
}

function loadPortrait(portrait) {
    if (!(portrait instanceof HTMLImageElement) || portrait.dataset.folioLoaded === 'true') return;
    const source = portrait.dataset.src;
    if (!source) return;
    portrait.dataset.folioLoaded = 'true';
    portrait.src = source;
}

function observePortrait(portrait) {
    if (!(portrait instanceof HTMLImageElement)) return;
    if (typeof IntersectionObserver !== 'function') {
        loadPortrait(portrait);
        return;
    }
    if (!portraitObserver) {
        const observerRevision = runtimeRevision;
        const observer = new IntersectionObserver(entries => {
            if (!isRuntimeCurrent(observerRevision) || portraitObserver !== observer) return;
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const image = entry.target;
                observer.unobserve(image);
                loadPortrait(image);
            }
        }, { root: null, rootMargin: '280px 0px', threshold: 0.01 });
        portraitObserver = observer;
    }
    portraitObserver.observe(portrait);
}

function createChevron(className = '') {
    const chevron = createElement('span', `folio-chevron ${className}`.trim());
    chevron.setAttribute('aria-hidden', 'true');
    return chevron;
}

function closeMenu({ restoreFocus = false } = {}) {
    const previous = activeMenuElement?.folioAnchor;
    if (previous instanceof HTMLElement) previous.setAttribute('aria-expanded', 'false');
    activeMenuCleanup?.();
    activeMenuCleanup = null;
    activeMenuElement?.remove();
    activeMenuElement = null;
    if (restoreFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus();
}

function positionMenu(menu, anchor, point) {
    const viewportPadding = 12;
    const menuRect = menu.getBoundingClientRect();
    let left = Number(point?.x);
    let top = Number(point?.y);

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
        const anchorRect = anchor instanceof Element ? anchor.getBoundingClientRect() : null;
        left = anchorRect?.left ?? viewportPadding;
        top = (anchorRect?.bottom ?? viewportPadding) + 6;
        if (top + menuRect.height > window.innerHeight - viewportPadding && anchorRect) {
            top = anchorRect.top - menuRect.height - 6;
        }
    }

    left = Math.min(Math.max(viewportPadding, left), Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding));
    top = Math.min(Math.max(viewportPadding, top), Math.max(viewportPadding, window.innerHeight - menuRect.height - viewportPadding));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
}

function openMenu({ anchor = null, point = null, label = tr('menu.default'), items = [], closeOnSelect = true, compact = false } = {}) {
    closeMenu();
    if (!folioRuntimeActive || !items.length) return;

    const menu = createElement('div', compact ? 'folio-menu folio-menu-compact' : 'folio-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    menu.folioAnchor = anchor;
    if (anchor instanceof HTMLElement) anchor.setAttribute('aria-expanded', 'true');
    const settings = getFolioSettings();
    menu.style.fontSize = `${settings.fontScale}%`;
    menu.dataset.cornerStyle = settings.cornerStyle;

    const menuItems = [];
    const refreshMenuSelection = () => {
        for (const { button, item } of menuItems) {
            const role = item.role || 'menuitemradio';
            if (role === 'menuitem') {
                button.removeAttribute('aria-checked');
                button.classList.remove('is-selected');
                continue;
            }
            const selected = typeof item.selected === 'function' ? Boolean(item.selected()) : Boolean(item.selected);
            button.setAttribute('aria-checked', selected ? 'true' : 'false');
            button.classList.toggle('is-selected', selected);
        }
    };

    for (const item of items) {
        const button = createElement('button', 'folio-menu-item', item.label);
        button.type = 'button';
        button.setAttribute('role', item.role || 'menuitemradio');
        menuItems.push({ button, item });
        button.addEventListener('click', () => {
            if (closeOnSelect) closeMenu();
            item.action?.();
            if (!closeOnSelect && menu.isConnected) {
                refreshMenuSelection();
                button.focus();
            }
        });
        menu.appendChild(button);
    }
    refreshMenuSelection();

    document.body.appendChild(menu);
    positionMenu(menu, anchor, point);
    activeMenuElement = menu;

    const handleOutside = event => {
        if (menu.contains(event.target)) return;
        closeMenu();
    };
    const handleKeydown = event => {
        if (!activeMenuElement) return;
        const buttons = Array.from(menu.querySelectorAll('.folio-menu-item'));
        const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeMenu({ restoreFocus: true });
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            buttons[(index + 1 + buttons.length) % buttons.length]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            buttons[0]?.focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            buttons.at(-1)?.focus();
        }
    };
    const handleViewportChange = () => closeMenu();
    const handleScroll = event => {
        if (menu.contains(event.target)) return;
        closeMenu();
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('resize', handleViewportChange, { once: true });
    window.addEventListener('scroll', handleScroll, { capture: true });
    activeMenuCleanup = () => {
        document.removeEventListener('pointerdown', handleOutside, true);
        document.removeEventListener('keydown', handleKeydown, true);
        window.removeEventListener('resize', handleViewportChange);
        window.removeEventListener('scroll', handleScroll, true);
    };
    menu.querySelector('.folio-menu-item')?.focus();
}

function attachLongPress(element, callback) {
    let timer = null;
    let resetTimer = null;
    let startX = 0;
    let startY = 0;
    let triggered = false;

    const clear = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    };
    const cancelReset = () => {
        if (resetTimer !== null) window.clearTimeout(resetTimer);
        resetTimer = null;
    };
    const finish = () => {
        clear();
        if (!triggered) return;
        cancelReset();
        // A synthesized click follows pointerup in the same event turn. Keep the
        // flag alive until that click has had a chance to consume it.
        resetTimer = window.setTimeout(() => {
            resetTimer = null;
            triggered = false;
        }, 0);
    };
    element.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' || event.button !== 0) return;
        const pressRevision = runtimeRevision;
        clear();
        cancelReset();
        triggered = false;
        startX = event.clientX;
        startY = event.clientY;
        timer = window.setTimeout(() => {
            timer = null;
            if (!isRuntimeCurrent(pressRevision) || !element.isConnected) return;
            triggered = true;
            callback({ x: startX, y: startY, sourceEvent: event });
        }, LONG_PRESS_DELAY);
    });
    element.addEventListener('pointermove', event => {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > LONG_PRESS_DISTANCE) clear();
    });
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
    element.addEventListener('lostpointercapture', finish);

    return () => {
        if (!triggered) return false;
        cancelReset();
        triggered = false;
        return true;
    };
}

function renderPager(container, currentPage, totalPages, onChange, label) {
    if (!(container instanceof HTMLElement)) return;
    container.replaceChildren();
    const normalizedTotal = Math.max(1, Number(totalPages) || 1);
    const normalizedCurrent = Math.min(Math.max(1, Number(currentPage) || 1), normalizedTotal);
    container.hidden = normalizedTotal <= 1;
    container.setAttribute('aria-hidden', container.hidden ? 'true' : 'false');
    if (container.hidden) return;

    const previous = createElement('button', 'folio-page-button', '‹');
    previous.type = 'button';
    previous.disabled = normalizedCurrent <= 1;
    previous.setAttribute('aria-label', tr('page.previous', label));
    previous.addEventListener('click', () => onChange(normalizedCurrent - 1));
    const status = createElement('span', 'folio-page-status', `${normalizedCurrent} / ${normalizedTotal}`);
    status.setAttribute('aria-live', 'polite');
    const next = createElement('button', 'folio-page-button', '›');
    next.type = 'button';
    next.disabled = normalizedCurrent >= normalizedTotal;
    next.setAttribute('aria-label', tr('page.next', label));
    next.addEventListener('click', () => onChange(normalizedCurrent + 1));
    container.append(previous, status, next);
}

function buildCard(characterRecord, contextValue, notes, availableTags) {
    const { character } = characterRecord;
    const avatar = getAvatarKey(character);
    const name = getCharacterName(character);
    const note = getStoredNote(avatar, notes);
    const pinned = isAvatarPinned(avatar, contextValue);
    const characterTags = getCharacterTags(character, contextValue, availableTags);

    const card = createElement('article', 'folio-card');
    card.dataset.avatar = avatar;
    card.dataset.pinned = pinned ? 'true' : 'false';
    card.dataset.hasTags = characterTags.length ? 'true' : 'false';
    card.setAttribute('role', 'listitem');

    const portraitButton = createElement('button', 'folio-card-open');
    portraitButton.type = 'button';
    portraitButton.setAttribute('aria-label', tr('card.openChats', name));

    const portraitWrap = createElement('span', 'folio-portrait-wrap');
    const portrait = createElement('img', 'folio-portrait');
    portrait.alt = '';
    portrait.decoding = 'async';
    portrait.fetchPriority = 'low';
    portrait.draggable = false;
    portrait.dataset.src = getPortraitUrl(character, contextValue);
    const portraitPlaceholder = createElement('span', 'folio-portrait-placeholder', getCharacterInitial(character));
    portraitPlaceholder.hidden = false;
    portraitPlaceholder.setAttribute('aria-hidden', 'true');
    portrait.addEventListener('load', () => {
        portrait.classList.add('is-loaded');
        portraitPlaceholder.hidden = true;
    }, { once: true });
    portrait.addEventListener('error', () => {
        portrait.hidden = true;
        portraitPlaceholder.hidden = false;
    }, { once: true });
    portraitWrap.append(portrait, portraitPlaceholder);
    if (pinned) {
        const pin = createElement('span', 'folio-pin-badge fa-solid fa-thumbtack');
        pin.setAttribute('aria-hidden', 'true');
        portraitWrap.appendChild(pin);
    }
    portraitButton.appendChild(portraitWrap);

    const showPinMenu = point => {
        openMenu({
            anchor: portraitButton,
            point,
            label: tr('card.pinMenu', name),
            compact: true,
            items: [{
                label: pinned ? tr('card.unpin') : tr('card.pin'),
                selected: pinned,
                action: () => togglePinnedAvatar(avatar),
            }],
        });
    };
    const consumeLongPress = attachLongPress(portraitButton, showPinMenu);
    portraitButton.addEventListener('contextmenu', event => {
        event.preventDefault();
        showPinMenu({ x: event.clientX, y: event.clientY });
    });
    portraitButton.addEventListener('click', event => {
        if (consumeLongPress()) {
            event.preventDefault();
            return;
        }
        openCharacterDrawer(character);
    });
    observePortrait(portrait);

    const body = createElement('div', 'folio-card-body');
    const meta = createElement('div', 'folio-card-meta');
    const nameButton = createElement('button', 'folio-character-name', name);
    nameButton.type = 'button';
    nameButton.title = name;
    nameButton.setAttribute('aria-label', tr('card.openChats', name));
    nameButton.addEventListener('click', () => openCharacterDrawer(character));

    const tagList = characterTags.length ? createElement('ul', 'folio-card-tags') : null;
    if (tagList) {
        tagList.setAttribute('aria-label', tr('card.tags', name));
        tagList.title = characterTags.map(tag => tag.name).join(', ');
        for (const tag of characterTags) {
            const badge = createElement('li', 'folio-card-tag', tag.name);
            badge.title = tag.name;
            tagList.appendChild(badge);
        }
        const overflowBadge = createElement('li', 'folio-card-tag folio-card-tag-overflow');
        overflowBadge.hidden = true;
        tagList.appendChild(overflowBadge);
    }

    const memoButton = createElement('button', 'folio-memo-edit');
    memoButton.type = 'button';
    memoButton.setAttribute('aria-label', tr('card.editNote', name));
    const memoText = createElement(
        'span',
        note ? 'folio-memo' : 'folio-memo folio-memo-placeholder',
        note || '...',
    );
    memoButton.appendChild(memoText);
    memoButton.addEventListener('click', () => openMemoEditor(character));

    meta.appendChild(nameButton);
    if (tagList) meta.appendChild(tagList);
    body.appendChild(meta);
    body.appendChild(memoButton);
    card.append(portraitButton, body);
    return card;
}

function getTagFlowLineMap(meta) {
    if (!(meta instanceof HTMLElement)) return new Map();
    const elements = [
        meta.querySelector('.folio-character-name'),
        ...meta.querySelectorAll('.folio-card-tag:not([hidden])'),
    ].filter(element => element instanceof HTMLElement);
    const lineCenters = [];
    const elementCenters = new Map();

    for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) continue;
        const center = rect.top + (rect.height / 2);
        elementCenters.set(element, center);
        if (!lineCenters.some(existing => Math.abs(existing - center) <= 2)) lineCenters.push(center);
    }

    lineCenters.sort((left, right) => left - right);
    return new Map(Array.from(elementCenters, ([element, elementCenter]) => [
        element,
        lineCenters.findIndex(center => Math.abs(center - elementCenter) <= 2),
    ]));
}

function getTagFlowLineIndex(meta, target) {
    return getTagFlowLineMap(meta).get(target) ?? Number.POSITIVE_INFINITY;
}

function layoutCardTagOverflow(card) {
    if (!(card instanceof HTMLElement)) return false;
    const meta = card.querySelector('.folio-card-meta');
    const tagList = card.querySelector('.folio-card-tags');
    const overflowBadge = card.querySelector('.folio-card-tag-overflow');
    if (!(meta instanceof HTMLElement) || !(tagList instanceof HTMLElement) || !(overflowBadge instanceof HTMLElement)) {
        return false;
    }
    if (!(meta.getBoundingClientRect().width > 0)) return false;

    const badges = Array.from(tagList.querySelectorAll('.folio-card-tag:not(.folio-card-tag-overflow)'))
        .filter(badge => badge instanceof HTMLElement);
    for (const badge of badges) badge.hidden = false;
    overflowBadge.hidden = true;
    overflowBadge.textContent = '';
    overflowBadge.removeAttribute('title');
    overflowBadge.removeAttribute('aria-label');

    const initialLineMap = getTagFlowLineMap(meta);
    let visibleCount = badges.findIndex(badge => (initialLineMap.get(badge) ?? Number.POSITIVE_INFINITY) >= 2);
    if (visibleCount < 0) visibleCount = badges.length;
    if (visibleCount === badges.length) {
        card.dataset.hiddenTagCount = '0';
        return true;
    }

    for (let index = visibleCount; index < badges.length; index += 1) badges[index].hidden = true;
    overflowBadge.hidden = false;

    while (true) {
        const hiddenBadges = badges.slice(visibleCount);
        const hiddenNames = hiddenBadges.map(badge => badge.textContent || '').filter(Boolean);
        overflowBadge.textContent = `+${hiddenBadges.length}`;
        overflowBadge.title = hiddenNames.join(', ');
        overflowBadge.setAttribute('aria-label', tr('card.hiddenTags', hiddenBadges.length, hiddenNames.join(', ')));

        if (getTagFlowLineIndex(meta, overflowBadge) < 2 || visibleCount === 0) break;
        visibleCount -= 1;
        badges[visibleCount].hidden = true;
    }

    card.dataset.hiddenTagCount = String(badges.length - visibleCount);
    return true;
}

function runCardTagLayout(expectedRoot = rootElement) {
    if (!expectedRoot?.isConnected || rootElement !== expectedRoot) return;
    for (const card of expectedRoot.querySelectorAll('.folio-card[data-has-tags="true"]')) {
        layoutCardTagOverflow(card);
    }
}

function cancelScheduledCardTagLayout() {
    if (tagLayoutFrame === null) return;
    if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(tagLayoutFrame);
    else globalThis.clearTimeout?.(tagLayoutFrame);
    tagLayoutFrame = null;
}

function scheduleCardTagLayout(expectedRoot = rootElement) {
    if (!(expectedRoot instanceof HTMLElement)) return;
    cancelScheduledCardTagLayout();
    const operationRevision = runtimeRevision;
    const run = () => {
        tagLayoutFrame = null;
        if (!isRuntimeCurrent(operationRevision)) return;
        runCardTagLayout(expectedRoot);
    };
    tagLayoutFrame = typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame(run)
        : globalThis.setTimeout(run, 0);
}

function disconnectTagLayoutObserver() {
    tagLayoutObserver?.disconnect();
    tagLayoutObserver = null;
    tagLayoutObservedGrid = null;
    tagLayoutObservedWidth = null;
    tagLayoutFontReadyRoot = null;
    if (tagLayoutResizeHandler && typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('resize', tagLayoutResizeHandler);
    }
    tagLayoutResizeHandler = null;
    cancelScheduledCardTagLayout();
}

function observeTagLayout(expectedRoot = rootElement) {
    if (!(expectedRoot instanceof HTMLElement)) return;
    const grid = expectedRoot.querySelector('.folio-grid');
    if (!(grid instanceof HTMLElement)) return;
    if (tagLayoutObservedGrid === grid) {
        scheduleCardTagLayout(expectedRoot);
        return;
    }

    disconnectTagLayoutObserver();
    tagLayoutObservedGrid = grid;
    const observerRevision = runtimeRevision;
    if (typeof globalThis.ResizeObserver === 'function') {
        const observer = new globalThis.ResizeObserver(entries => {
            if (!isRuntimeCurrent(observerRevision) || tagLayoutObserver !== observer || rootElement !== expectedRoot) return;
            const entry = entries.find(candidate => candidate.target === grid);
            const width = Number(entry?.contentRect?.width);
            if (!Number.isFinite(width) || Math.abs(width - (tagLayoutObservedWidth ?? -1)) < 0.5) return;
            tagLayoutObservedWidth = width;
            scheduleCardTagLayout(expectedRoot);
        });
        tagLayoutObserver = observer;
        observer.observe(grid);
    } else if (typeof globalThis.addEventListener === 'function') {
        tagLayoutResizeHandler = () => scheduleCardTagLayout(expectedRoot);
        globalThis.addEventListener('resize', tagLayoutResizeHandler, { passive: true });
    }
    const fontReady = globalThis.document?.fonts?.ready;
    if (fontReady && typeof fontReady.then === 'function') {
        tagLayoutFontReadyRoot = expectedRoot;
        void fontReady.then(() => {
            if (
                tagLayoutFontReadyRoot === expectedRoot
                && isRuntimeCurrent(observerRevision)
                && rootElement === expectedRoot
            ) scheduleCardTagLayout(expectedRoot);
        });
    }
    scheduleCardTagLayout(expectedRoot);
}

function renderCharacterGrid(expectedRoot = rootElement) {
    // This deliberately also renders a detached root. mountFolio builds the
    // complete first frame before inserting it, so Folio never flashes in late.
    if (!expectedRoot || rootElement !== expectedRoot) return;
    const grid = expectedRoot.querySelector('.folio-grid');
    const pager = expectedRoot.querySelector('.folio-character-pager');
    if (!(grid instanceof HTMLElement) || !(pager instanceof HTMLElement)) return;

    const contextValue = safeContext();
    const notes = getStoredNotes(contextValue);
    const settings = getFolioSettings(contextValue);
    const normalizedSearch = currentSearch.trim().toLocaleLowerCase();
    const allCharacters = getCharactersForDisplay(contextValue);
    const availableTags = getAvailableTags(contextValue);
    const availableTagIds = new Set(availableTags.map(tag => tag.id));
    for (const tagId of currentTagIds) {
        if (!availableTagIds.has(tagId)) currentTagIds.delete(tagId);
    }
    updateTagFilterControl(contextValue, expectedRoot);
    const filtered = allCharacters.filter(({ character }) => {
        const matchesSearch = !normalizedSearch || getCharacterName(character).toLocaleLowerCase().includes(normalizedSearch);
        return matchesSearch && characterMatchesSelectedTags(character, currentTagIds, contextValue);
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / settings.characterPageSize));
    currentCharacterPage = Math.min(Math.max(1, currentCharacterPage), totalPages);
    const startIndex = (currentCharacterPage - 1) * settings.characterPageSize;
    const visible = filtered.slice(startIndex, startIndex + settings.characterPageSize);

    disconnectPortraitObserver();
    const fragment = document.createDocumentFragment();
    for (const characterRecord of visible) {
        fragment.appendChild(buildCard(characterRecord, contextValue, notes, availableTags));
    }

    grid.replaceChildren(fragment);
    if (visible.length === 0) {
        const message = tr(normalizedSearch || currentTagIds.size ? 'empty.searchCharacters' : 'empty.characters');
        grid.appendChild(createElement('p', 'folio-state is-empty', message));
    }
    renderPager(pager, currentCharacterPage, totalPages, page => {
        if (rootElement !== expectedRoot || !expectedRoot.isConnected) return;
        currentCharacterPage = page;
        renderCharacterGrid(expectedRoot);
        scrollFolioToTopInsideChat(expectedRoot);
    }, tr('page.characters'));
    scheduleCardTagLayout(expectedRoot);
}

function updateVisibleNote(avatar, note) {
    if (!rootElement?.isConnected) return;
    for (const card of rootElement.querySelectorAll('.folio-card')) {
        if (!(card instanceof HTMLElement) || card.dataset.avatar !== avatar) continue;
        const memo = card.querySelector('.folio-memo');
        if (!(memo instanceof HTMLElement)) continue;
        memo.textContent = note || '...';
        memo.classList.toggle('folio-memo-placeholder', !note);
    }
}

function createOverlay() {
    const overlay = createElement('div', 'folio-overlay');
    overlay.id = OVERLAY_ID;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeDrawer();
    });
    overlay.addEventListener('keydown', handleOverlayKeydown);

    const drawer = createElement('section', 'folio-drawer');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'folio-drawer-title');
    overlay.appendChild(drawer);

    overlayElement = overlay;
    drawerElement = drawer;
    return overlay;
}

function restoreWelcomeShortcuts() {
    if (shortcutsElement instanceof HTMLElement && shortcutsOriginalParent instanceof HTMLElement) {
        if (shortcutsOriginalParent.isConnected) {
            if (
                shortcutsOriginalNextSibling instanceof Node &&
                shortcutsOriginalNextSibling.parentNode === shortcutsOriginalParent
            ) {
                shortcutsOriginalParent.insertBefore(shortcutsElement, shortcutsOriginalNextSibling);
            } else {
                shortcutsOriginalParent.appendChild(shortcutsElement);
            }
        }
    }
    shortcutsHostElement?.remove();
    document.getElementById(SHORTCUTS_HOST_ID)?.remove();
    shortcutsHostElement = null;
    shortcutsElement = null;
    shortcutsOriginalParent = null;
    shortcutsOriginalNextSibling = null;
}

function mountWelcomeShortcuts(welcomePanel, chatElement) {
    restoreWelcomeShortcuts();
    const shortcuts = welcomePanel.querySelector('.welcomeShortcuts');
    const originalParent = shortcuts?.parentElement;
    if (!(shortcuts instanceof HTMLElement) || !(originalParent instanceof HTMLElement)) return;

    const host = createElement('div', 'folio-shortcuts-host');
    host.id = SHORTCUTS_HOST_ID;
    host.setAttribute('aria-label', tr('shortcuts.label'));
    shortcutsElement = shortcuts;
    shortcutsOriginalParent = originalParent;
    shortcutsOriginalNextSibling = shortcuts.nextSibling;
    shortcutsHostElement = host;
    host.appendChild(shortcuts);
    chatElement.appendChild(host);
}

function keepWelcomeShortcutsLast(chatElement) {
    if (
        shortcutsHostElement?.parentElement === chatElement &&
        chatElement.lastElementChild !== shortcutsHostElement
    ) {
        chatElement.appendChild(shortcutsHostElement);
    }
}

function buildRoot() {
    const root = createElement('section', 'folio-shell');
    root.id = ROOT_ID;
    root.setAttribute('aria-labelledby', 'folio-title');
    currentSortMode = getStoredSortMode();

    const header = createElement('header', 'folio-header');
    const heading = createElement('div', 'folio-heading');
    const sortControl = createElement('button', 'folio-sort-control');
    sortControl.type = 'button';
    sortControl.setAttribute('aria-haspopup', 'menu');
    sortControl.setAttribute('aria-label', tr('sort.characterLabel'));
    const title = createElement('span', 'folio-title', 'Folio');
    title.id = 'folio-title';
    const sortCaret = createChevron('folio-sort-caret');
    sortControl.title = uiSortLabel(currentSortMode);
    sortControl.addEventListener('click', () => {
        openMenu({
            anchor: sortControl,
            label: tr('sort.characterLabel'),
            items: SORT_OPTIONS.map(option => ({
                label: uiSortLabel(option.value),
                selected: option.value === currentSortMode,
                action: () => {
                    saveSortMode(option.value);
                    sortControl.title = uiSortLabel(option.value);
                },
            })),
        });
    });
    sortControl.append(title, sortCaret);
    heading.appendChild(sortControl);

    const filterControls = createElement('div', 'folio-filter-controls');
    const searchWrap = createElement('div', 'folio-search-wrap');
    const search = createElement('input', 'folio-search');
    search.type = 'search';
    search.placeholder = tr('sort.searchPlaceholder');
    search.autocomplete = 'off';
    search.setAttribute('aria-label', tr('sort.searchLabel'));
    search.addEventListener('input', () => {
        currentSearch = search.value;
        currentCharacterPage = 1;
        renderCharacterGrid();
    });
    searchWrap.appendChild(search);

    const tagButton = createElement('button', 'folio-tag-filter');
    tagButton.type = 'button';
    tagButton.setAttribute('aria-haspopup', 'menu');
    tagButton.setAttribute('aria-label', tr('filter.tagLabel'));
    const tagLabel = createElement('span', 'folio-tag-filter-label', tr('filter.tags'));
    tagButton.append(tagLabel, createChevron('folio-tag-filter-caret'));
    tagButton.addEventListener('click', () => {
        const tags = getAvailableTags();
        const availableTagIds = new Set(tags.map(tag => tag.id));
        for (const tagId of currentTagIds) {
            if (!availableTagIds.has(tagId)) currentTagIds.delete(tagId);
        }
        openMenu({
            anchor: tagButton,
            label: tr('filter.tagMenu'),
            closeOnSelect: false,
            items: [
                {
                    label: tr('filter.all'),
                    role: 'menuitemcheckbox',
                    selected: () => currentTagIds.size === 0,
                    action: () => {
                        currentTagIds.clear();
                        currentCharacterPage = 1;
                        renderCharacterGrid();
                    },
                },
                ...tags.map(tag => ({
                    label: tag.name,
                    role: 'menuitemcheckbox',
                    selected: () => currentTagIds.has(tag.id),
                    action: () => {
                        if (currentTagIds.has(tag.id)) currentTagIds.delete(tag.id);
                        else currentTagIds.add(tag.id);
                        currentCharacterPage = 1;
                        renderCharacterGrid();
                    },
                })),
            ],
        });
    });
    filterControls.append(searchWrap, tagButton);
    header.append(heading, filterControls);

    const grid = createElement('div', 'folio-grid');
    grid.setAttribute('role', 'list');

    const pager = createElement('nav', 'folio-pager folio-character-pager');
    pager.setAttribute('aria-label', tr('page.characterLabel'));

    root.append(header, grid, pager);
    rootElement = root;
    createOverlay();
    applyVisualSettings();
    renderCharacterGrid(root);
    return root;
}

function applyVisualSettings() {
    const settings = getFolioSettings();
    for (const element of [rootElement, overlayElement, settingsElement, activeMenuElement]) {
        if (!(element instanceof HTMLElement)) continue;
        element.dataset.cornerStyle = settings.cornerStyle;
    }
    const contentFontSize = `${settings.fontScale}%`;
    if (rootElement instanceof HTMLElement) {
        rootElement.style.removeProperty('font-size');
        rootElement.style.setProperty('--folio-content-font-size', contentFontSize);
        rootElement.style.setProperty('--folio-desktop-columns', String(settings.desktopColumns));
        rootElement.style.setProperty('--folio-mobile-columns', String(settings.mobileColumns));
        rootElement.style.removeProperty('--folio-card-min-width');
        rootElement.style.removeProperty('--folio-mobile-card-min-width');
        rootElement.style.removeProperty('--folio-pin-scale');
        delete rootElement.dataset.portraitScale;
        rootElement.dataset.portraitRatio = settings.portraitRatio;
    }
    for (const element of [overlayElement, activeMenuElement]) {
        if (element instanceof HTMLElement) element.style.fontSize = contentFontSize;
    }
    if (settingsElement instanceof HTMLElement) settingsElement.style.removeProperty('font-size');
    scheduleCardTagLayout();
}

function handlePreferenceChange(key) {
    if (key === 'enabled') {
        reconcileFolioRuntime();
        return;
    }
    applyVisualSettings();
    if (key === 'imageQuality') {
        renderCharacterGrid();
    } else if (key === 'characterPageSize') {
        currentCharacterPage = 1;
        renderCharacterGrid();
    } else if (key === 'chatPageSize') {
        currentChatPage = 1;
        if (activeChatState?.body?.isConnected) {
            renderChatRows(activeChatState.body, activeChatState.character, activeChatState.chats);
        }
    }
}

function syncSettingsControls(container, settings = getFolioSettings()) {
    if (!(container instanceof HTMLElement)) return;
    translateSettingsText(container);

    const enabledControl = container.querySelector('#folio-enabled');
    if (enabledControl instanceof HTMLInputElement && enabledControl.type === 'checkbox') {
        enabledControl.checked = settings.enabled;
    }

    for (const { id, key } of SELECT_SETTING_CONTROLS) {
        const control = container.querySelector(`#${id}`);
        if (control instanceof HTMLSelectElement) control.value = String(settings[key]);
    }

    for (const { id, key, values, unit, indexed = false } of RANGE_SETTING_CONTROLS) {
        const control = container.querySelector(`#${id}`);
        const output = container.querySelector(`#${id}-value`);
        if (!(control instanceof HTMLInputElement) || !(output instanceof HTMLOutputElement)) continue;

        const value = settings[key];
        control.value = String(indexed ? values.indexOf(value) : value);
        const label = unit === 'count' ? tr('unit.count', value) : `${value}${unit}`;
        output.value = label;
        control.setAttribute('aria-valuetext', label);
    }
}

async function confirmFolioDataCleanup() {
    const ctx = context();
    const title = tr('settings.cleanupTitle');
    const message = tr('settings.cleanupMessage');

    if (typeof ctx.Popup === 'function' && ctx.POPUP_TYPE?.CONFIRM !== undefined) {
        const content = createElement('div', 'folio-data-cleanup-confirm');
        content.append(
            createElement('h3', '', title),
            createElement('p', '', message),
        );
        const popup = new ctx.Popup(content, ctx.POPUP_TYPE.CONFIRM, null);
        const result = await popup.show();
        return result === true || result === ctx.POPUP_RESULT?.AFFIRMATIVE;
    }
    if (ctx.Popup?.show?.confirm) {
        const result = await ctx.Popup.show.confirm(title, message);
        return result === true || result === ctx.POPUP_RESULT?.AFFIRMATIVE;
    }
    return window.confirm(`${title}\n${message}`);
}

async function requestFolioDataCleanup(button, container = settingsElement) {
    if (cleaningFolioData || !lifecycleEnabled) return;
    const operationRevision = lifecycleRevision;
    cleaningFolioData = true;
    const controlsToLock = [];
    if (container instanceof HTMLElement) {
        if (typeof container.querySelectorAll === 'function') {
            controlsToLock.push(...container.querySelectorAll('input, select, button'));
        } else {
            const enabledControl = container.querySelector('#folio-enabled');
            if (enabledControl) controlsToLock.push(enabledControl);
        }
    }
    if (button && !controlsToLock.includes(button)) controlsToLock.push(button);
    const previousDisabledStates = new Map(
        controlsToLock.map(control => [control, Boolean(control.disabled)]),
    );
    for (const control of controlsToLock) control.disabled = true;
    if (button instanceof HTMLButtonElement) {
        button.setAttribute('aria-busy', 'true');
    }

    try {
        const confirmed = await confirmFolioDataCleanup();
        if (!confirmed || !lifecycleEnabled || operationRevision !== lifecycleRevision || !container?.isConnected) return;

        const cleared = await clearStoredFolioData(context(), () => (
            lifecycleEnabled &&
            operationRevision === lifecycleRevision &&
            Boolean(container?.isConnected)
        ));
        if (cleared === null) return;
        if (!lifecycleEnabled || operationRevision !== lifecycleRevision || !container?.isConnected) return;

        currentSortMode = DEFAULT_SORT_MODE;
        currentChatSortMode = DEFAULT_CHAT_SORT_MODE;
        currentCharacterPage = 1;
        currentChatPage = 1;
        sessionRecentByAvatar.clear();
        randomOrderByAvatar.clear();
        closeMenu();
        closeDrawer({ restoreFocus: false });
        syncSettingsControls(container);
        reconcileFolioRuntime();
        applyVisualSettings();
        if (rootElement?.isConnected) {
            const sortControl = rootElement.querySelector('.folio-sort-control');
            if (sortControl instanceof HTMLButtonElement) {
                sortControl.title = uiSortLabel(currentSortMode);
            }
            renderCharacterGrid();
        }
    } catch (error) {
        console.error('[Folio] Failed to clear stored data:', error);
    } finally {
        if (operationRevision === lifecycleRevision) {
            cleaningFolioData = false;
            for (const [control, wasDisabled] of previousDisabledStates) {
                if (control?.isConnected) control.disabled = wasDisabled;
            }
            if (button instanceof HTMLButtonElement && button.isConnected) {
                button.removeAttribute('aria-busy');
            }
        }
    }
}

function bindSettingsControls(container) {
    const settings = getFolioSettings();
    syncSettingsControls(container, settings);
    if (container.dataset.folioBound === 'true') return;
    container.dataset.folioBound = 'true';

    const enabledControl = container.querySelector('#folio-enabled');
    if (enabledControl instanceof HTMLInputElement && enabledControl.type === 'checkbox') {
        enabledControl.addEventListener('change', () => savePreference('enabled', enabledControl.checked));
    }

    for (const { id, key } of SELECT_SETTING_CONTROLS) {
        const control = container.querySelector(`#${id}`);
        if (!(control instanceof HTMLSelectElement)) continue;
        control.addEventListener('change', () => savePreference(key, control.value));
    }

    for (const definition of RANGE_SETTING_CONTROLS) {
        const { id, key, values, unit, indexed = false, live = false } = definition;
        const control = container.querySelector(`#${id}`);
        const output = container.querySelector(`#${id}-value`);
        if (!(control instanceof HTMLInputElement) || control.type !== 'range' || !(output instanceof HTMLOutputElement)) continue;

        const readValue = () => {
            const rawValue = Number(control.value);
            return indexed ? values[rawValue] ?? settings[key] : rawValue;
        };
        const syncValue = () => {
            const value = readValue();
            const label = unit === 'count' ? tr('unit.count', value) : `${value}${unit}`;
            output.value = label;
            control.setAttribute('aria-valuetext', label);
            return value;
        };

        control.addEventListener('input', () => {
            const value = syncValue();
            if (live) savePreference(key, value);
        });
        if (!live) control.addEventListener('change', () => savePreference(key, syncValue()));
    }

    const dataCleanupButton = container.querySelector('#folio-data-cleanup');
    if (dataCleanupButton instanceof HTMLButtonElement) {
        dataCleanupButton.addEventListener('click', () => void requestFolioDataCleanup(dataCleanupButton, container));
    }
}

async function mountSettings() {
    if (!lifecycleEnabled) return null;
    const existing = document.getElementById(SETTINGS_ID);
    if (existing instanceof HTMLElement) {
        settingsElement = existing;
        bindSettingsControls(existing);
        applyVisualSettings();
        return existing;
    }
    if (settingsMountPromise) return settingsMountPromise;

    const mountRevision = lifecycleRevision;
    const mountPromise = (async () => {
        try {
            const ctx = context();
            const host = document.getElementById('extensions_settings2');
            if (!host || typeof ctx.renderExtensionTemplateAsync !== 'function') return null;
            const html = await ctx.renderExtensionTemplateAsync(EXTENSION_PATH, 'settings');
            if (!lifecycleEnabled || mountRevision !== lifecycleRevision || document.getElementById(SETTINGS_ID)) {
                return document.getElementById(SETTINGS_ID);
            }
            host.insertAdjacentHTML('beforeend', html);
            const mounted = document.getElementById(SETTINGS_ID);
            if (!(mounted instanceof HTMLElement)) return null;
            settingsElement = mounted;
            bindSettingsControls(mounted);
            applyVisualSettings();
            return mounted;
        } catch (error) {
            console.error('[Folio] Failed to mount settings:', error);
            return null;
        }
    })();
    settingsMountPromise = mountPromise;
    void mountPromise.finally(() => {
        if (settingsMountPromise === mountPromise) settingsMountPromise = null;
    });
    return mountPromise;
}

function mountFolio(welcomePanel) {
    if (!folioRuntimeActive || !(welcomePanel instanceof HTMLElement)) return;
    const chatElement = welcomePanel.parentElement;
    if (!chatElement || chatElement.id !== 'chat') return;

    const existing = document.getElementById(ROOT_ID);
    const existingOverlay = document.getElementById(OVERLAY_ID);
    if (
        existing &&
        existing.parentElement === chatElement &&
        existing.previousElementSibling === welcomePanel &&
        existingOverlay
    ) {
        rootElement = existing;
        overlayElement = existingOverlay;
        drawerElement = existingOverlay.querySelector('.folio-drawer');
        observeTagLayout(existing);
        if (!document.getElementById(SHORTCUTS_HOST_ID)) mountWelcomeShortcuts(welcomePanel, chatElement);
        keepWelcomeShortcutsLast(chatElement);
        return;
    }

    // A native welcome refresh can replace the welcome panel without emitting
    // CHAT_CHANGED. Retire any drawer request tied to the detached root first.
    activeListSequence += 1;
    activeListController?.abort();
    activeListController = null;
    activeDrawerAvatar = '';
    activeChatState = null;
    closeMenu();
    disconnectPortraitObserver();
    disconnectTagLayoutObserver();
    restoreWelcomeShortcuts();
    existing?.remove();
    overlayElement?.remove();
    existingOverlay?.remove();
    overlayElement = null;
    drawerElement = null;

    currentCharacterPage = 1;
    currentSearch = '';
    currentTagIds.clear();
    const completedRoot = buildRoot();
    welcomePanel.insertAdjacentElement('afterend', completedRoot);
    observeTagLayout(completedRoot);
    if (overlayElement) document.body.appendChild(overlayElement);
    mountWelcomeShortcuts(welcomePanel, chatElement);
    keepWelcomeShortcutsLast(chatElement);
}

function mountCurrentWelcome() {
    const welcomePanel = findDirectWelcomePanel();
    if (welcomePanel) mountFolio(welcomePanel);
}

function ensureChatObserver() {
    if (chatObserver || !folioRuntimeActive) return;
    const chatElement = document.getElementById('chat');
    if (!chatElement) return;

    const observerRevision = runtimeRevision;
    const observer = new MutationObserver(records => {
        if (!isRuntimeCurrent(observerRevision) || chatObserver !== observer) return;
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (
                    node instanceof HTMLElement &&
                    node.parentElement === chatElement &&
                    node.classList.contains('welcomePanel')
                ) {
                    // MutationObserver callbacks run before the next paint. Build the
                    // complete Folio tree first and insert it once, without a skeleton flash.
                    mountFolio(node);
                    return;
                }
            }
        }
        keepWelcomeShortcutsLast(chatElement);
    });
    chatObserver = observer;
    observer.observe(chatElement, { childList: true, subtree: false });
}

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter(element => element instanceof HTMLElement && !element.hidden);
}

function handleOverlayKeydown(event) {
    if (!overlayElement || overlayElement.hidden) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
        return;
    }
    if (event.key !== 'Tab' || !drawerElement) return;

    const focusable = getFocusableElements(drawerElement);
    if (!focusable.length) {
        event.preventDefault();
        drawerElement.focus();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function showDrawer() {
    if (!overlayElement || !drawerElement) return;
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayElement.hidden = false;
    overlayElement.setAttribute('aria-hidden', 'false');
    overlayElement.classList.add('is-open');
}

function closeDrawer({ restoreFocus = true } = {}) {
    activeListSequence += 1;
    activeListController?.abort();
    activeListController = null;
    activeDrawerAvatar = '';
    activeChatState = null;
    currentChatPage = 1;
    closeMenu();

    if (overlayElement) {
        overlayElement.classList.remove('is-open');
        overlayElement.hidden = true;
        overlayElement.setAttribute('aria-hidden', 'true');
    }
    if (drawerElement) drawerElement.replaceChildren();
    if (restoreFocus && lastFocusedElement?.isConnected) lastFocusedElement.focus();
    lastFocusedElement = null;
}

function buildDrawerHeader(character, titleText, { chatSort = false, onChatSortChange = null } = {}) {
    const header = createElement('header', 'folio-drawer-header');
    const characterBlock = createElement('div', 'folio-drawer-character');
    const avatar = createElement('img', 'folio-drawer-avatar');
    avatar.src = getThumbnailUrl(character);
    avatar.alt = '';
    avatar.decoding = 'async';
    avatar.draggable = false;
    const avatarPlaceholder = createElement('span', 'folio-drawer-avatar folio-drawer-avatar-placeholder', getCharacterInitial(character));
    avatarPlaceholder.hidden = true;
    avatarPlaceholder.setAttribute('aria-hidden', 'true');
    avatar.addEventListener('error', () => {
        avatar.hidden = true;
        avatarPlaceholder.hidden = false;
    }, { once: true });
    characterBlock.append(avatar, avatarPlaceholder);

    if (chatSort) {
        const sortControl = createElement('button', 'folio-drawer-sort-control');
        sortControl.type = 'button';
        sortControl.setAttribute('aria-haspopup', 'menu');
        sortControl.setAttribute('aria-label', tr('drawer.sortLabel', titleText));
        const title = createElement('span', 'folio-drawer-title', titleText);
        title.id = 'folio-drawer-title';
        const caret = createChevron('folio-drawer-sort-caret');
        sortControl.title = uiChatSortLabel(currentChatSortMode);
        sortControl.addEventListener('click', () => {
            openMenu({
                anchor: sortControl,
                label: tr('drawer.sortLabel', titleText),
                items: CHAT_SORT_OPTIONS.map(option => ({
                    label: uiChatSortLabel(option.value),
                    selected: option.value === currentChatSortMode,
                    action: () => {
                        saveChatSortMode(option.value);
                        sortControl.title = uiChatSortLabel(option.value);
                        onChatSortChange?.(currentChatSortMode);
                    },
                })),
            });
        });
        sortControl.append(title, caret);
        characterBlock.appendChild(sortControl);
    } else {
        const title = createElement('h3', 'folio-drawer-title', titleText);
        title.id = 'folio-drawer-title';
        characterBlock.appendChild(title);
    }

    const close = createElement('button', 'folio-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', tr('drawer.close'));
    close.addEventListener('click', () => closeDrawer());
    header.append(characterBlock, close);
    return header;
}

function renderDrawerState(parent, kind, message) {
    if (!(parent instanceof Element)) return;
    const state = createElement('div', `folio-state ${kind ? `is-${kind}` : ''}`.trim());
    state.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    if (kind === 'loading') {
        const spinner = createElement('span', 'folio-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        state.appendChild(spinner);
    }
    state.appendChild(document.createTextNode(message));
    parent.replaceChildren(state);
}

function normalizeChatList(payload) {
    if (!Array.isArray(payload)) return [];
    const seen = new Set();
    const chats = [];
    for (const item of payload) {
        const rawId = typeof item === 'string'
            ? item
            : (typeof item?.file_id === 'string' ? item.file_id : item?.file_name);
        if (typeof rawId !== 'string') continue;
        const fileId = rawId.replace(/\.jsonl$/i, '').trim();
        if (!fileId || seen.has(fileId)) continue;
        seen.add(fileId);
        chats.push({ fileId, title: fileId });
    }
    return chats;
}

function sortChatList(chats, sortMode = currentChatSortMode, avatar = '') {
    const sorted = Array.isArray(chats) ? [...chats] : [];
    if (sortMode === 'title-asc') {
        sorted.sort((left, right) => collator.compare(left.title, right.title));
    } else {
        sorted.sort((left, right) => collator.compare(right.title, left.title));
    }
    const pinned = getPinnedChatIds(avatar);
    if (!pinned.length) return sorted;
    const order = new Map(pinned.map((id, index) => [id, index]));
    const featured = [];
    const rest = [];
    for (const chat of sorted) {
        if (order.has(chat.fileId)) featured.push(chat);
        else rest.push(chat);
    }
    featured.sort((left, right) => order.get(left.fileId) - order.get(right.fileId));
    return [...featured, ...rest];
}

function renderChatRows(container, character, chats) {
    if (!(container instanceof HTMLElement)) return;
    const safeChats = Array.isArray(chats) ? chats : [];
    const settings = getFolioSettings();
    const avatar = getAvatarKey(character);
    const pinnedChats = new Set(getPinnedChatIds(avatar));
    const sortedChats = sortChatList(safeChats, currentChatSortMode, avatar);
    const query = currentChatSearch.trim().toLocaleLowerCase();
    const matchingChats = query ? sortedChats.filter(chat => chat.title.toLocaleLowerCase().includes(query)) : sortedChats;
    const totalPages = Math.max(1, Math.ceil(matchingChats.length / settings.chatPageSize));
    currentChatPage = Math.min(Math.max(1, currentChatPage), totalPages);
    const startIndex = (currentChatPage - 1) * settings.chatPageSize;
    const visibleChats = matchingChats.slice(startIndex, startIndex + settings.chatPageSize);
    activeChatState = { character, chats: safeChats, body: container };

    let searchWrap = container.querySelector('.folio-chat-search-wrap');
    if (!searchWrap) {
        searchWrap = createElement('div', 'folio-chat-search-wrap');
        const search = createElement('input', 'folio-chat-search text_pole');
        search.type = 'search';
        search.placeholder = tr('search.chats');
        search.setAttribute('aria-label', tr('search.chats'));
        search.autocomplete = 'off';
        search.value = currentChatSearch;
        search.addEventListener('input', () => {
            currentChatSearch = search.value;
            currentChatPage = 1;
            const state = activeChatState;
            if (state?.body === container) renderChatRows(container, state.character, state.chats);
        });
        searchWrap.appendChild(search);
    }

    const content = createElement('div', 'folio-chat-content');
    if (!matchingChats.length) {
        const state = createElement('div', 'folio-state is-empty');
        state.setAttribute('role', 'status');
        state.appendChild(createElement('p', 'folio-state-message',
            tr(!safeChats.length ? 'empty.chats' : 'empty.chatSearch')));
        content.appendChild(state);
    } else {
        const list = createElement('div', 'folio-chat-list');
        list.setAttribute('role', 'list');
        for (const chat of visibleChats) {
            const item = createElement('div', 'folio-chat-item');
            item.setAttribute('role', 'listitem');
            const pinned = pinnedChats.has(chat.fileId);
            const row = createElement('button', pinned ? 'folio-chat-row is-pinned' : 'folio-chat-row');
            row.type = 'button';
            row.setAttribute('aria-label', tr('chat.open', chat.title, pinned ? tr('chat.pinnedSuffix') : ''));
            const title = createElement('span', 'folio-chat-title', chat.title);
            title.title = chat.title;
            if (pinned) {
                const icon = createElement('i', 'folio-chat-pinned-icon fa-solid fa-thumbtack');
                icon.setAttribute('aria-hidden', 'true');
                row.appendChild(icon);
            }
            row.appendChild(title);
            const showChatActionMenu = point => {
                openMenu({
                    anchor: row,
                    point,
                    label: tr('chat.menu', chat.title),
                    compact: true,
                    items: [
                        {
                            label: pinned ? tr('chat.unpin') : tr('chat.pin'),
                            role: 'menuitem',
                            action: () => togglePinnedChat(avatar, chat.fileId),
                        },
                        {
                            label: tr('chat.rename'),
                            role: 'menuitem',
                            action: () => void requestRenameChat(character, chat, row),
                        },
                        {
                            label: tr('chat.delete'),
                            role: 'menuitem',
                            action: () => void requestDeleteChat(character, chat, row),
                        },
                    ],
                });
            };
            const consumeLongPress = attachLongPress(row, showChatActionMenu);
            row.addEventListener('contextmenu', event => {
                event.preventDefault();
                showChatActionMenu({ x: event.clientX, y: event.clientY });
            });
            row.addEventListener('click', event => {
                if (consumeLongPress()) {
                    event.preventDefault();
                    return;
                }
                void openExistingChat(character, chat.fileId, row);
            });

            const remove = createElement('button', 'folio-chat-delete', '×');
            remove.type = 'button';
            remove.setAttribute('aria-label', tr('chat.deleteLabel', chat.title));
            remove.title = tr('chat.deleteTitle');
            remove.addEventListener('click', event => {
                event.stopPropagation();
                void requestDeleteChat(character, chat, remove);
            });
            item.append(row, remove);
            list.appendChild(item);
        }
        content.appendChild(list);
    }

    const footer = createElement('footer', 'folio-chat-footer');
    const pager = createElement('nav', 'folio-pager folio-chat-pager');
    pager.setAttribute('aria-label', tr('chat.pageLabel'));
    renderPager(pager, currentChatPage, totalPages, page => {
        currentChatPage = page;
        renderChatRows(container, character, safeChats);
        container.scrollTop = 0;
    }, tr('page.chats'));
    const start = createElement('button', 'folio-button primary folio-start-chat', tr('chat.newChat'));
    start.type = 'button';
    start.addEventListener('click', () => void startNewCharacterChat(character, start));
    footer.append(pager, start);
    let results = container.querySelector('.folio-chat-results');
    if (!results) {
        results = createElement('div', 'folio-chat-results');
        container.replaceChildren(searchWrap, results);
    }
    results.replaceChildren(content, footer);
}

async function fetchCharacterChats(character, signal) {
    const ctx = context();
    const response = await fetch(CHAT_LIST_ENDPOINT, {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ avatar_url: getAvatarKey(character), simple: true }),
        signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return normalizeChatList(await response.json());
}

async function refreshActiveChatList(character, { requireActive = true } = {}) {
    const requestRuntimeRevision = runtimeRevision;
    const avatar = getAvatarKey(character);
    const state = activeChatState;
    if (requireActive && (!state || getAvatarKey(state.character) !== avatar || !state.body?.isConnected)) return null;

    activeListSequence += 1;
    const requestSequence = activeListSequence;
    activeListController?.abort();
    const controller = new AbortController();
    activeListController = controller;
    try {
        const chats = await fetchCharacterChats(character, controller.signal);
        const shouldRender = (
            isRuntimeCurrent(requestRuntimeRevision) &&
            !controller.signal.aborted &&
            requestSequence === activeListSequence &&
            activeDrawerAvatar === avatar &&
            state?.body?.isConnected
        );
        if (shouldRender) renderChatRows(state.body, character, chats);
        return chats;
    } catch (error) {
        if (!controller.signal.aborted && requestSequence === activeListSequence) {
            console.error('[Folio] Failed to refresh character chat filenames:', error);
        }
        return null;
    } finally {
        if (activeListController === controller) activeListController = null;
    }
}

async function confirmChatDeletion(chatTitle) {
    const ctx = context();
    if (typeof ctx.Popup === 'function' && ctx.POPUP_TYPE?.CONFIRM !== undefined) {
        const content = createElement('div', 'folio-delete-confirm');
        content.append(
            createElement('h3', '', tr('delete.title')),
            createElement('p', '', tr('delete.message', chatTitle)),
        );
        const popup = new ctx.Popup(content, ctx.POPUP_TYPE.CONFIRM, null);
        const result = await popup.show();
        return result === true || result === ctx.POPUP_RESULT?.AFFIRMATIVE;
    }
    if (ctx.Popup?.show?.confirm) {
        const safeTitle = String(chatTitle)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
        const result = await ctx.Popup.show.confirm(
            tr('delete.title'),
            tr('delete.message', safeTitle),
        );
        return result === true || result === ctx.POPUP_RESULT?.AFFIRMATIVE;
    }
    return window.confirm(tr('delete.fallback', chatTitle));
}

function normalizeChatRenameValue(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\.jsonl$/i, '').trim();
}

async function promptChatRename(chatTitle) {
    const ctx = context();
    if (ctx.Popup?.show?.input) {
        return await ctx.Popup.show.input(
            tr('rename.title'),
            tr('rename.prompt'),
            chatTitle,
            { okButton: tr('action.save'), cancelButton: tr('action.cancel') },
        );
    }
    return window.prompt(tr('rename.prompt'), chatTitle);
}

async function showChatRenameNotice(message) {
    const ctx = context();
    if (typeof ctx.Popup === 'function' && ctx.POPUP_TYPE?.TEXT !== undefined) {
        const content = createElement('div', 'folio-rename-notice');
        content.append(
            createElement('h3', '', tr('rename.unavailable')),
            createElement('p', '', message),
        );
        const popup = new ctx.Popup(content, ctx.POPUP_TYPE.TEXT, null);
        await popup.show();
        return;
    }
    window.alert(message);
}

function getChatOperationBody(avatar) {
    const state = activeChatState;
    return state && getAvatarKey(state.character) === avatar && state.body instanceof HTMLElement
        ? state.body
        : null;
}

function isChatOperationBodyCurrent(body, avatar, operationRevision) {
    return (
        isRuntimeCurrent(operationRevision) &&
        body instanceof HTMLElement &&
        body.isConnected &&
        activeDrawerAvatar === avatar &&
        activeChatState?.body === body &&
        getAvatarKey(activeChatState?.character) === avatar
    );
}

async function requestRenameChat(character, chat, trigger) {
    if (renamingChat || deletingChat || openingChat || !folioRuntimeActive) return;

    const operationRevision = runtimeRevision;
    const avatar = getAvatarKey(character);
    const operationBody = getChatOperationBody(avatar);
    const operationChats = activeChatState?.body === operationBody ? activeChatState.chats : [];
    renamingChat = true;
    if (trigger instanceof HTMLButtonElement) {
        trigger.disabled = true;
        trigger.setAttribute('aria-busy', 'true');
    }
    try {
        const requestedName = await promptChatRename(chat.title);
        if (!isChatOperationBodyCurrent(operationBody, avatar, operationRevision) || requestedName === false || requestedName === null) return;

        const newName = normalizeChatRenameValue(requestedName);
        if (!newName) {
            await showChatRenameNotice(tr('rename.empty'));
            return;
        }
        if (collator.compare(newName, chat.fileId) === 0) return;

        const duplicate = operationChats.some(item => (
            item.fileId !== chat.fileId && collator.compare(item.fileId, newName) === 0
        ));
        if (duplicate) {
            await showChatRenameNotice(tr('rename.duplicate'));
            return;
        }

        const ctx = context();
        const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
        const characterId = characters.findIndex(item => getAvatarKey(item) === avatar);
        if (characterId < 0) {
            if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
                renderDrawerState(operationBody, 'error', tr('error.characterMissing'));
            }
            return;
        }

        const previousChatIds = new Set(
            operationChats.map(item => item.fileId),
        );
        const wasCharacterDefault = normalizeChatRenameValue(characters[characterId]?.chat) === chat.fileId;

        await renameGroupOrCharacterChat({
            characterId: String(characterId),
            oldFileName: chat.fileId,
            newFileName: newName,
            loader: true,
        });
        migratePinnedChatId(avatar, chat.fileId, newName);
        const refreshedChats = await fetchCharacterChats(character);
        const addedChats = Array.isArray(refreshedChats) && !refreshedChats.some(item => item.fileId === chat.fileId)
            ? refreshedChats.filter(item => !previousChatIds.has(item.fileId))
            : [];
        const renamedChat = addedChats.length === 1 ? addedChats[0] : null;
        if (
            wasCharacterDefault &&
            renamedChat &&
            normalizeChatRenameValue(characters[characterId]?.chat) === chat.fileId
        ) {
            await updateRemoteChatName(String(characterId), renamedChat.fileId);
        }
        if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
            renderChatRows(operationBody, character, refreshedChats);
        }
    } catch (error) {
        console.error('[Folio] Failed to rename chat:', error);
        if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
            renderDrawerState(operationBody, 'error', tr('error.rename'));
        }
    } finally {
        renamingChat = false;
        if (trigger instanceof HTMLButtonElement && trigger.isConnected) {
            trigger.disabled = false;
            trigger.removeAttribute('aria-busy');
        }
    }
}

async function requestDeleteChat(character, chat, trigger) {
    if (deletingChat || renamingChat || openingChat || !folioRuntimeActive) return;
    const operationRevision = runtimeRevision;
    const avatar = getAvatarKey(character);
    const operationBody = getChatOperationBody(avatar);
    deletingChat = true;
    if (trigger instanceof HTMLButtonElement) {
        trigger.disabled = true;
        trigger.setAttribute('aria-busy', 'true');
    }
    try {
        const confirmed = await confirmChatDeletion(chat.title);
        if (!confirmed || !isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) return;

        const ctx = context();
        const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
        const characterId = characters.findIndex(item => getAvatarKey(item) === avatar);
        if (characterId < 0) {
            renderDrawerState(operationBody, 'error', tr('error.characterMissing'));
            return;
        }

        await deleteCharacterChatByName(String(characterId), chat.fileId);
        removePinnedChatId(avatar, chat.fileId);
        if (!isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) return;
        const state = activeChatState;
        if (state?.body === operationBody) {
            const remaining = state.chats.filter(item => item.fileId !== chat.fileId);
            renderChatRows(operationBody, character, remaining);
            await refreshActiveChatList(character);
        }
    } catch (error) {
        console.error('[Folio] Failed to delete chat:', error);
        if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
            renderDrawerState(operationBody, 'error', tr('error.delete'));
        }
    } finally {
        deletingChat = false;
        if (trigger instanceof HTMLButtonElement && trigger.isConnected) {
            trigger.disabled = false;
            trigger.removeAttribute('aria-busy');
        }
    }
}

async function openCharacterDrawer(character) {
    if (!folioRuntimeActive || !drawerElement || !overlayElement) return;
    const operationRevision = runtimeRevision;
    const avatar = getAvatarKey(character);
    if (!avatar) return;

    activeListSequence += 1;
    const requestSequence = activeListSequence;
    activeListController?.abort();
    const controller = new AbortController();
    activeListController = controller;
    activeDrawerAvatar = avatar;

    currentChatSortMode = getStoredChatSortMode();
    currentChatPage = 1;
    currentChatSearch = '';
    activeChatState = null;
    const body = createElement('div', 'folio-drawer-body');
    const header = buildDrawerHeader(character, getCharacterName(character), {
        chatSort: true,
        onChatSortChange: () => {
            const state = activeChatState;
            if (
                state &&
                state.body === body &&
                getAvatarKey(state.character) === avatar &&
                body.isConnected
            ) renderChatRows(body, character, state.chats);
        },
    });
    drawerElement.replaceChildren(header, body);
    renderDrawerState(body, 'loading', tr('loading.chats'));
    showDrawer();
    drawerElement.querySelector('.folio-close')?.focus();

    try {
        const loadedChats = await fetchCharacterChats(character, controller.signal);
        if (
            !isRuntimeCurrent(operationRevision) ||
            controller.signal.aborted ||
            requestSequence !== activeListSequence ||
            activeDrawerAvatar !== avatar ||
            !body.isConnected
        ) return;

        renderChatRows(body, character, loadedChats);
    } catch (error) {
        if (controller.signal.aborted || requestSequence !== activeListSequence) return;
        console.error('[Folio] Failed to load character chat filenames:', error);
        if (body.isConnected) renderDrawerState(body, 'error', tr('error.loadChats'));
    } finally {
        if (activeListController === controller) activeListController = null;
    }
}

function normalizeChatId(value) {
    return typeof value === 'string' ? value.replace(/\.jsonl$/i, '') : '';
}

async function startNewCharacterChat(character, button) {
    if (openingChat || deletingChat || renamingChat || !folioRuntimeActive) return;
    const operationRevision = runtimeRevision;
    const avatar = getAvatarKey(character);
    const operationBody = getChatOperationBody(avatar);
    const hadSavedChats = activeChatState && getAvatarKey(activeChatState.character) === avatar
        ? activeChatState.chats.length > 0
        : true;
    const ctx = context();
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    const characterId = characters.findIndex(item => getAvatarKey(item) === avatar);
    if (characterId < 0) {
        if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
            renderDrawerState(operationBody, 'error', tr('error.characterMissing'));
        }
        return;
    }

    openingChat = true;
    if (button instanceof HTMLButtonElement) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
    }
    try {
        await ctx.selectCharacterById(characterId, { switchMenu: false });
        if (!isRuntimeCurrent(operationRevision)) return;
        const selectedContext = context();
        const selectedCharacters = Array.isArray(selectedContext.characters) ? selectedContext.characters : [];
        const selectedCharacter = selectedCharacters[Number(selectedContext.characterId)];
        if (getAvatarKey(selectedCharacter) !== avatar) {
            throw new Error('Character selection did not complete.');
        }

        setActiveCharacter(avatar);
        selectedContext.saveSettingsDebounced?.();
        if (hadSavedChats) {
            if (typeof selectedContext.executeSlashCommandsWithOptions !== 'function') {
                throw new Error('SillyTavern slash command API is unavailable.');
            }
            await selectedContext.executeSlashCommandsWithOptions('/newchat');
            if (!isRuntimeCurrent(operationRevision)) return;
        }
        sessionRecentByAvatar.set(avatar, Date.now());
        if (isRuntimeCurrent(operationRevision)) closeDrawer({ restoreFocus: false });
    } catch (error) {
        console.error('[Folio] Failed to start chat:', error);
        if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
            renderDrawerState(operationBody, 'error', tr('error.startChat'));
        }
    } finally {
        openingChat = false;
        if (button instanceof HTMLButtonElement && button.isConnected) {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    }
}

async function openExistingChat(character, fileId, row) {
    if (openingChat || deletingChat || renamingChat || !folioRuntimeActive) return;
    const operationRevision = runtimeRevision;
    const avatar = getAvatarKey(character);
    const operationBody = getChatOperationBody(avatar);
    const ctx = context();
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    const characterId = characters.findIndex(item => getAvatarKey(item) === avatar);
    if (characterId < 0) {
        if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
            renderDrawerState(operationBody, 'error', tr('error.characterMissing'));
        }
        return;
    }

    const currentCharacter = characters[Number(ctx.characterId)];
    if (
        getAvatarKey(currentCharacter) === avatar &&
        normalizeChatId(ctx.getCurrentChatId?.()) === normalizeChatId(fileId)
    ) {
        closeDrawer();
        return;
    }

    openingChat = true;
    if (row instanceof HTMLButtonElement) {
        row.disabled = true;
        row.setAttribute('aria-busy', 'true');
    }
    try {
        await ctx.selectCharacterById(characterId);
        if (!isRuntimeCurrent(operationRevision)) return;

        // SillyTavern can decline a character switch while a chat is saving or
        // a group is generating, without returning a success value. Never pass
        // the selected filename to whatever character happened to stay active.
        const selectedContext = context();
        const selectedCharacters = Array.isArray(selectedContext.characters) ? selectedContext.characters : [];
        const selectedCharacter = selectedCharacters[Number(selectedContext.characterId)];
        if (getAvatarKey(selectedCharacter) !== avatar) {
            throw new Error('Character selection did not complete.');
        }

        setActiveCharacter(avatar);
        selectedContext.saveSettingsDebounced?.();
        if (normalizeChatId(selectedContext.getCurrentChatId?.()) !== normalizeChatId(fileId)) {
            await selectedContext.openCharacterChat(fileId);
            if (!isRuntimeCurrent(operationRevision)) return;
        }
        sessionRecentByAvatar.set(avatar, Date.now());
        if (isRuntimeCurrent(operationRevision)) closeDrawer({ restoreFocus: false });
    } catch (error) {
        console.error('[Folio] Failed to open chat:', error);
        if (isChatOperationBodyCurrent(operationBody, avatar, operationRevision)) {
            renderDrawerState(operationBody, 'error', tr('error.openChat'));
        }
    } finally {
        openingChat = false;
        if (row instanceof HTMLButtonElement && row.isConnected) {
            row.disabled = false;
            row.removeAttribute('aria-busy');
        }
    }
}

function openMemoEditor(character) {
    if (!folioRuntimeActive || !drawerElement || !overlayElement) return;
    const avatar = getAvatarKey(character);
    if (!avatar) return;

    activeListSequence += 1;
    activeListController?.abort();
    activeListController = null;
    activeDrawerAvatar = avatar;

    drawerElement.replaceChildren();
    drawerElement.appendChild(buildDrawerHeader(character, tr('memo.title', getCharacterName(character))));
    const body = createElement('div', 'folio-drawer-body');
    const editor = createElement('form', 'folio-memo-editor');
    const input = createElement('textarea', 'folio-memo-input');
    input.maxLength = NOTE_LIMIT;
    input.rows = 3;
    input.value = getStoredNote(avatar);
    input.placeholder = tr('memo.placeholder');
    input.setAttribute('aria-label', tr('memo.label', getCharacterName(character), NOTE_LIMIT));

    const actions = createElement('div', 'folio-memo-actions');
    const cancel = createElement('button', 'folio-button', tr('action.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => closeDrawer());
    const save = createElement('button', 'folio-button primary', tr('action.save'));
    save.type = 'submit';
    actions.append(cancel, save);
    editor.append(input, actions);
    editor.addEventListener('submit', event => {
        event.preventDefault();
        saveNote(avatar, input.value);
        closeDrawer();
    });
    body.appendChild(editor);
    drawerElement.appendChild(body);
    showDrawer();
    input.focus();
}

function recordCurrentCharacterAsRecent() {
    const ctx = safeContext();
    if (!ctx || !Array.isArray(ctx.characters)) return;
    const character = ctx.characters[Number(ctx.characterId)];
    const avatar = getAvatarKey(character);
    if (avatar && ctx.getCurrentChatId?.() !== undefined) {
        sessionRecentByAvatar.set(avatar, Date.now());
    }
}

function clearDetachedRootReferences() {
    if (rootElement?.isConnected) return;
    activeListSequence += 1;
    activeListController?.abort();
    activeListController = null;
    disconnectPortraitObserver();
    disconnectTagLayoutObserver();
    closeMenu();
    restoreWelcomeShortcuts();
    overlayElement?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
    rootElement = null;
    overlayElement = null;
    drawerElement = null;
    activeDrawerAvatar = '';
    activeChatState = null;
}

function stopFolioRuntime() {
    folioRuntimeActive = false;
    runtimeRevision += 1;
    activeListSequence += 1;
    activeListController?.abort();
    activeListController = null;
    chatObserver?.disconnect();
    chatObserver = null;
    disconnectPortraitObserver();
    disconnectTagLayoutObserver();
    closeMenu();
    unbindRuntimeEvents();
    restoreWelcomeShortcuts();

    document.getElementById(ROOT_ID)?.remove();
    overlayElement?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
    rootElement = null;
    overlayElement = null;
    drawerElement = null;
    activeDrawerAvatar = '';
    activeChatState = null;
    lastFocusedElement = null;
    currentCharacterPage = 1;
    currentChatPage = 1;
    currentChatSearch = '';
    currentSearch = '';
    currentTagIds.clear();
    currentSortMode = DEFAULT_SORT_MODE;
    currentChatSortMode = DEFAULT_CHAT_SORT_MODE;
    pendingCharacterRefresh = false;
    sessionRecentByAvatar.clear();
    randomOrderByAvatar.clear();
}

function startFolioRuntime() {
    if (!lifecycleEnabled || !getFolioSettings().enabled) return;
    if (!folioRuntimeActive) {
        folioRuntimeActive = true;
        runtimeRevision += 1;
    }
    bindRuntimeEvents();
    ensureChatObserver();
    mountCurrentWelcome();
}

function reconcileFolioRuntime() {
    if (!lifecycleEnabled) return;
    if (getFolioSettings().enabled) startFolioRuntime();
    else stopFolioRuntime();
}

function handleAppReady() {
    if (!lifecycleEnabled) return;
    void mountSettings();
    reconcileFolioRuntime();
}

function handleChatChanged() {
    if (!folioRuntimeActive) return;
    recordCurrentCharacterAsRecent();
    clearDetachedRootReferences();
    mountCurrentWelcome();
    if (pendingCharacterRefresh && rootElement?.isConnected) {
        renderCharacterGrid();
    }
    pendingCharacterRefresh = false;
}

function handleExtensionSettingsLoaded() {
    if (!lifecycleEnabled) return;
    void mountSettings();
    reconcileFolioRuntime();
}

function handleCharacterRenamed(oldAvatar, newAvatar) {
    if (!lifecycleEnabled) return;
    migrateNote(oldAvatar, newAvatar);
    migratePinnedAvatar(oldAvatar, newAvatar);
    migratePinnedChatsForAvatar(oldAvatar, newAvatar);
    if (sessionRecentByAvatar.has(oldAvatar)) {
        sessionRecentByAvatar.set(newAvatar, sessionRecentByAvatar.get(oldAvatar));
        sessionRecentByAvatar.delete(oldAvatar);
    }
    if (randomOrderByAvatar.has(oldAvatar)) {
        randomOrderByAvatar.set(newAvatar, randomOrderByAvatar.get(oldAvatar));
        randomOrderByAvatar.delete(oldAvatar);
    }
    if (!folioRuntimeActive) return;
    pendingCharacterRefresh = true;
    if (activeDrawerAvatar === oldAvatar) closeDrawer({ restoreFocus: false });
}

function handleCharacterDeleted(payload) {
    if (!lifecycleEnabled) return;
    const avatar = getAvatarKey(payload?.character);
    deleteNoteForAvatar(avatar);
    deletePinnedAvatar(avatar);
    deletePinnedChatsForAvatar(avatar);
    sessionRecentByAvatar.delete(avatar);
    randomOrderByAvatar.delete(avatar);
    if (!folioRuntimeActive) return;
    pendingCharacterRefresh = true;
    if (activeDrawerAvatar === avatar) closeDrawer({ restoreFocus: false });
}

function bindEvent(eventName, handler, bindings) {
    const eventSource = safeContext()?.eventSource;
    if (!eventName || !eventSource?.on) return;
    eventSource.on(eventName, handler);
    bindings.push({ eventName, handler });
}

function bindHostEvents() {
    if (hostEventBindings.length) return;
    const ctx = safeContext();
    const types = ctx?.eventTypes || ctx?.event_types || {};
    bindEvent(types.APP_READY, handleAppReady, hostEventBindings);
    bindEvent(types.EXTENSION_SETTINGS_LOADED, handleExtensionSettingsLoaded, hostEventBindings);
    bindEvent(types.CHARACTER_RENAMED, handleCharacterRenamed, hostEventBindings);
    bindEvent(types.CHARACTER_DELETED, handleCharacterDeleted, hostEventBindings);
}

function bindRuntimeEvents() {
    if (runtimeEventBindings.length) return;
    const ctx = safeContext();
    const types = ctx?.eventTypes || ctx?.event_types || {};
    bindEvent(types.CHAT_CHANGED, handleChatChanged, runtimeEventBindings);
}

function unbindEventGroup(bindings) {
    const eventSource = safeContext()?.eventSource;
    for (const { eventName, handler } of bindings) {
        try {
            if (typeof eventSource?.off === 'function') eventSource.off(eventName, handler);
            else if (typeof eventSource?.removeListener === 'function') eventSource.removeListener(eventName, handler);
        } catch {
            // Best-effort cleanup during extension disable.
        }
    }
    bindings.length = 0;
}

function unbindHostEvents() {
    unbindEventGroup(hostEventBindings);
}

function unbindRuntimeEvents() {
    unbindEventGroup(runtimeEventBindings);
}

function initialize() {
    if (!lifecycleEnabled || initialized) return;
    initialized = true;
    bindHostEvents();
    void mountSettings();
    reconcileFolioRuntime();

    if (!document.getElementById('chat') && document.readyState === 'loading' && !domReadyHandler) {
        domReadyHandler = () => {
            domReadyHandler = null;
            if (!lifecycleEnabled) return;
            void mountSettings();
            reconcileFolioRuntime();
        };
        document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
    }
}

function cleanup() {
    lifecycleRevision += 1;
    stopFolioRuntime();
    unbindHostEvents();

    if (domReadyHandler) {
        document.removeEventListener('DOMContentLoaded', domReadyHandler);
        domReadyHandler = null;
    }

    settingsElement?.remove();
    document.getElementById(SETTINGS_ID)?.remove();
    settingsElement = null;
    settingsMountPromise = null;
    activeDrawerAvatar = '';
    activeChatState = null;
    currentChatSearch = '';
    lastFocusedElement = null;
    cleaningFolioData = false;
    sessionRecentByAvatar.clear();
    randomOrderByAvatar.clear();
    initialized = false;
}

export function onActivate() {
    lifecycleEnabled = true;
    initialize();
}

export function onEnable() {
    lifecycleEnabled = true;
    initialize();
}

export function onDisable() {
    lifecycleEnabled = false;
    cleanup();
}
