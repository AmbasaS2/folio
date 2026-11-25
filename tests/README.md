# Folio regression tests

These developer-only tests run Folio's unmodified JavaScript module, CSS and
settings template in a real Chromium browser. A small isolated SillyTavern
host fixture provides synthetic character metadata, event hooks and filename
responses. No live SillyTavern instance, API key, user data or chat files are
needed. Unrecognized network requests are blocked.

## Run locally

From the repository root, with Node.js 22 and npm:

    npm install --no-save --no-package-lock playwright-core@1.57.0
    npx playwright-core install chromium
    node --test tests/folio-regression.test.mjs

On a Linux machine without browser system libraries, use
'npx playwright-core install --with-deps chromium' instead. To use an already
installed Chromium/Chrome binary, set CHROMIUM_EXECUTABLE to its path before
running the tests. Do not commit node_modules.

## Coverage

- Welcome shelf with 240 characters, zero chat-list requests and zero writes.
- Desktop/mobile column-and-row pagination, resizing, name search and pins.
- Combined tag filters, bounded tag overflow, height-only viewport changes.
- Character pinning and memo saving without rebuilding an unchanged card.
- Only the chosen character's filenames are fetched (simple: true).
- Local chat title search, pin ordering, pagination and native chat opening.
- Deferred out-of-order responses, drawer closure and welcome replacement.
- Duplicate/invalid filenames and a refused native character switch.
- Disable, enable and preference toggles: abort outstanding requests, release
  Folio-owned observers and restore native welcome shortcuts, with no duplicate
  host event bindings.

The tests are not imported by index.js or listed in the extension manifest.
They add no observers, timers, network requests, or dependencies to Folio at
runtime. The fixture instruments browser observers only during testing.

This suite does not certify the live SillyTavern server, iOS Safari, other
extensions, or real user storage. Native integration and real-device smoke
tests are still needed when those areas change.

Baseline: Folio 1.5.7, b363c1767656ca92a55d67d42f9a6dd676ab7738.
Verified locally in Google Chrome 153 on Linux: 14/14 passed, with 390px and
1000px viewport coverage. Runtime files and manifest are unchanged.
