# 🗂️ Folio

**Folio is a lightweight, character-first doorway to your existing SillyTavern chats.**

It adds a visual character shelf to the SillyTavern welcome screen, where you can find a character first and then open, create, rename, or delete that character's chats. SillyTavern's native welcome shortcuts remain available below the shelf.

## 🧭 How it works

**Open the welcome screen → find a character → click the portrait or name → choose an existing chat or start a new one**

The welcome shelf is built from the character list SillyTavern has already loaded. A character's chat filenames are requested only after you explicitly open that character's chat drawer.

## 🗂️ Character shelf

Each character card shows the portrait, name, assigned SillyTavern tags, and an optional personal note.

| Control or action | What it does |
|---|---|
| **Search** | Finds characters by name. Partial matches are supported. |
| **Tag** | Selects one or more SillyTavern tags. When several tags are selected, only characters that have all of them are shown. |
| **Folio title / sort menu** | Sorts by recent chat, name, chat volume, or **Random order**. Choosing Random again reshuffles. Page changes and filtering preserve the randomized order; pinned characters stay on top. |
| **Click a portrait or name** | Opens that character's chat drawer. |
| **Long-press or right-click a portrait** | Pins the character to the top of the shelf or removes the pin. Pinned characters stay above the selected sort order. |
| **Click the note area** | Adds or edits a short note of up to 100 characters. Cards normally show up to three lines, or four when there is no tag row. |
| **Page controls** | Moves between character pages when the filtered results exceed the selected page size. |

The recent-chat and chat-volume sort modes use only metadata already present in SillyTavern's loaded character records. Chat volume is based on the loaded chat-size metadata, not the number of chat rooms, and Folio does not scan individual chat files.

Portraits are loaded as they approach the visible area. If a portrait cannot be loaded, Folio shows the character's initial instead.

## 💬 Character chat drawer

Clicking a character opens a drawer containing that character's saved chat filenames.

| Control or action | What it does |
|---|---|
| **Character name / sort menu** | Sorts chat titles ascending or descending, with pinned chats always at the top. |
| **Search chat titles** | Filters already-loaded chat titles for the selected character without scanning messages or making requests on each keystroke. |
| **Click a chat title** | Opens the selected chat through SillyTavern. |
| **Long-press or right-click a chat title** | Opens pin/unpin, rename, and delete actions. Pinned chats are stored per character; pins follow renames and are removed when chats are deleted. |
| Desktop hover `×` beside a chat | Deletes that chat after confirmation. Touch devices use the long-press menu instead. |
| **New Chat** | Selects the character and starts a new chat. |
| **Page controls** | Moves between chat pages when the list exceeds the selected page size. |

Renaming requires a non-empty name and will not overwrite another chat with the same name. Deleted chats cannot be recovered, so Folio always asks for confirmation first.

## ⚙️ Extension settings

Configure Folio under **Extensions → Folio**.

| Setting | Options and behavior |
|---|---|
| **Enable Folio** | Shows or hides Folio on the welcome screen. |
| **Portrait quality** | Uses low-quality thumbnails or high-quality original portraits. |
| **Portrait ratio** | Displays portraits vertically at 2:3 or as squares at 1:1. |
| **Portrait display settings** | Choose the number across for **desktop (2–7)** and **mobile (1–5)** independently (both default to 3), plus the number of **vertical rows per page (1–8; default 4)**. Pages show *columns × rows* portraits: 3 × 4 = 12 by default. Below 38rem viewport width, the mobile count applies; changing across the breakpoint updates page length automatically. |
| **Chats per page** | Shows 5, 10, 15, or 20 chats per page. The default is 10. |
| **Font size** | Adjusts Folio's content text from 80% to 150%. |
| **Corners** | Switches between sharp and rounded corners. |
| **Clean up setting data** | Deletes Folio's stored settings after confirmation and returns its saved preferences to the defaults. Characters and chats are not deleted. |

For a large character library or lighter mobile use, the low-quality thumbnail option is recommended. Choose high-quality originals when portrait sharpness matters more than loading weight.

## 🌍 Interface language

Folio follows the **SillyTavern UI language** for the shelf, settings, chat drawer and dialogs. English is the fallback. Korean, Japanese, Simplified Chinese, Traditional Chinese, and Spanish translations are included. Character names, notes, and saved chat titles are never translated.

## ⚡ Lightweight behavior

Folio is designed to avoid indexing or previewing the contents of an entire chat library.

Folio does not change SillyTavern's **Recent Chats** settings or make the base welcome screen load faster by itself. If you reduce the number of chats loaded by Recent Chats, Folio provides a lightweight character-first route back to the rest of your saved chat filenames.

| Stage | Data Folio uses |
|---|---|
| **Welcome shelf** | SillyTavern's already-loaded character array and the metadata on those character records. No chat-list request is made. |
| **After a character click** | Only that character's chat filenames are requested for the drawer. |
| **Not fetched or parsed by Folio** | Chat JSONL contents, message previews, per-chat statistics, file sizes, and timestamps. |

Opening a selected chat is handed back to SillyTavern's normal chat-opening flow. Folio itself does not generate summaries or call a language model.

## 💾 Storage and cleanup

- Appearance, desktop/mobile horizontal counts, shared portrait rows per page, chat page size, sort modes, pinned characters, per-character pinned chats, and notes are stored in SillyTavern's extension settings. Legacy portrait-scale and fixed portrait-page-size preferences remain stored for rollback but no longer affect the layout or pagination.
- Search text, selected tag filters, and the current page are temporary view state and are not persisted.
- Folio does not make copies of chat messages or create its own chat-content database.
- **Clean up setting data** removes Folio's saved settings, sort choices, pins, and notes and restores the defaults. It does not delete character cards or chat files.

---

# 🗂️ Folio

**Folio는 기존 SillyTavern 채팅을 캐릭터부터 골라 가볍게 열 수 있는 확장입니다.**

SillyTavern 시작 화면에 캐릭터 선반을 추가해, 먼저 캐릭터를 찾고 그 캐릭터의 채팅을 열거나 새로 만들고 이름을 바꾸거나 삭제할 수 있습니다. SillyTavern의 기존 시작 화면 단축 버튼도 선반 아래에 그대로 표시됩니다.

## 🧭 사용 순서

**시작 화면 열기 → 캐릭터 찾기 → 초상화나 이름 누르기 → 기존 채팅을 열거나 새 대화 시작하기**

시작 화면의 캐릭터 선반은 SillyTavern이 이미 불러온 캐릭터 목록으로 만듭니다. 캐릭터의 채팅 파일명은 사용자가 해당 캐릭터의 채팅 서랍을 직접 열었을 때만 요청합니다.

## 🗂️ 캐릭터 선반

각 캐릭터 카드에는 초상화, 이름, SillyTavern에 지정된 태그와 선택적으로 작성한 개인 메모가 표시됩니다.

| 조작 | 기능 |
|---|---|
| **검색** | 캐릭터 이름으로 찾습니다. 이름 일부만 입력해도 검색됩니다. |
| **태그** | SillyTavern 태그를 하나 이상 선택합니다. 여러 태그를 고르면 선택한 태그를 모두 가진 캐릭터만 표시됩니다. |
| **Folio 제목 / 정렬 메뉴** | 최근 대화순, 이름 오름차순·내림차순, 대화량 많은 순, **랜덤 정렬**을 지원합니다. 랜덤을 다시 선택하면 새로 섞고, 페이지를 넘기거나 필터를 바꿀 때는 순서가 유지됩니다. 고정한 캐릭터는 위에 남습니다. |
| **초상화 또는 이름 클릭** | 해당 캐릭터의 채팅 서랍을 엽니다. |
| **초상화 길게 누르기 또는 우클릭** | 캐릭터를 선반 상단에 고정하거나 고정을 해제합니다. 고정한 캐릭터는 선택한 정렬 순서보다 위에 유지됩니다. |
| **메모 영역 클릭** | 최대 100자의 짧은 메모를 추가하거나 수정합니다. 카드에는 보통 최대 3줄, 태그 줄이 없으면 최대 4줄까지 표시됩니다. |
| **페이지 버튼** | 필터링한 결과가 설정한 페이지당 개수를 넘으면 캐릭터 페이지를 이동합니다. |

최근 대화순과 대화량 많은 순은 SillyTavern이 이미 불러온 캐릭터 정보 안의 메타데이터만 사용합니다. 대화량은 채팅방 개수가 아니라 이미 불러온 채팅 크기 정보를 기준으로 하며, 개별 채팅 파일을 훑어보지 않습니다.

초상화는 화면에 가까워질 때 불러옵니다. 초상화를 불러오지 못하면 캐릭터 이름의 첫 글자를 대신 표시합니다.

## 💬 캐릭터 채팅 서랍

캐릭터를 누르면 그 캐릭터에게 저장된 채팅 파일명이 서랍에 표시됩니다.

| 조작 | 기능 |
|---|---|
| **캐릭터 이름 / 정렬 메뉴** | 채팅 제목을 오름차순 또는 내림차순으로 정렬하고, 고정한 채팅방은 맨 위에 표시합니다. |
| **채팅방 이름 검색** | 선택한 캐릭터의 이미 불러온 채팅방 이름을 검색합니다. 입력할 때 새 파일을 열거나 추가 요청을 보내지 않습니다. |
| **채팅 제목 클릭** | 선택한 채팅을 SillyTavern에서 엽니다. |
| **채팅 제목 길게 누르기 또는 우클릭** | **상단 고정·고정 해제**, 이름 바꾸기, 삭제 메뉴를 엽니다. 고정은 캐릭터별로 저장하고 이름을 바꾸면 따라가며, 채팅방을 삭제하면 고정도 정리합니다. |
| 데스크톱에서 채팅에 마우스를 올리면 나타나는 `×` | 확인 후 해당 채팅을 삭제합니다. 터치 기기에서는 길게 누르기 메뉴를 사용합니다. |
| **새 대화 시작** | 캐릭터를 선택하고 새 채팅을 시작합니다. |
| **페이지 버튼** | 채팅 목록이 설정한 페이지당 개수를 넘으면 채팅 페이지를 이동합니다. |

채팅 이름은 한 글자 이상 입력해야 하며, 같은 캐릭터에게 이미 있는 채팅과 같은 이름으로 덮어쓸 수 없습니다. 삭제한 채팅은 복구할 수 없으므로 Folio가 먼저 확인합니다.

## ⚙️ 확장 설정

**Extensions → Folio**에서 설정합니다.

| 설정 | 선택 항목과 기능 |
|---|---|
| **Folio 활성화** | 시작 화면에서 Folio를 표시하거나 숨깁니다. |
| **초상화 화질** | 저화질 썸네일 또는 고화질 원본 초상화를 사용합니다. |
| **초상화 비율** | 세로형 2:3 또는 정사각형 1:1로 표시합니다. |
| **초상화 노출 설정** | **가로 (🖥️)** 2~7개, **가로 (📱)** 1~5개를 각각 선택하고, **세로 줄 수**는 1~8줄 중 선택합니다. 기본값은 가로 각각 3개·세로 4줄로 **한 페이지에 12개**입니다. 페이지당 초상화 수는 가로 개수 × 세로 줄 수로 자동 계산됩니다. 화면 폭 38rem(약 608px) 이하에서는 모바일 가로 개수를 사용하며, 화면 크기에 따라 페이지당 개수도 갱신됩니다. |
| **페이지당 채팅 개수** | 한 페이지에 5, 10, 15, 20개 중 하나를 표시합니다. 기본값은 10개입니다. |
| **글씨 크기** | Folio 내용의 글씨 크기를 80%에서 150%까지 조절합니다. |
| **모서리** | 각진 모서리와 둥근 모서리를 전환합니다. |
| **세팅 데이터 정리** | 확인 후 Folio에 저장된 설정을 삭제하고 저장된 환경설정을 기본값으로 되돌립니다. 캐릭터와 채팅은 삭제하지 않습니다. |

캐릭터가 많거나 모바일에서 가볍게 사용하고 싶다면 저화질 썸네일을 권장합니다. 불러오기 부담보다 초상화의 선명도가 더 중요할 때는 고화질 원본을 선택하면 됩니다.

## 🌍 화면 언어

폴리오는 **SillyTavern의 UI 언어 설정**을 자동으로 따릅니다. 캐릭터 목록, 확장 설정, 정렬, 채팅방 목록과 확인창에 적용됩니다. 영어를 기본으로 한국어·일본어·중국어 간체·중국어 번체·스페인어를 지원하며, 그 외 언어는 영어로 표시합니다. 기존 캐릭터 이름·메모·채팅방 제목은 번역하거나 변경하지 않습니다.

## ⚡ 가벼운 동작 구조

Folio는 전체 채팅 라이브러리의 내용을 색인하거나 미리보기로 만들지 않도록 설계되어 있습니다.

Folio 자체가 SillyTavern의 **Recent Chats** 설정을 바꾸거나 기본 시작 화면의 로딩을 직접 빠르게 만드는 것은 아닙니다. Recent Chats가 불러오는 채팅 수를 줄여 두었다면, Folio가 나머지 저장된 채팅 파일명으로 다시 들어갈 수 있는 가벼운 캐릭터 중심 경로를 제공합니다.

| 단계 | Folio가 사용하는 정보 |
|---|---|
| **시작 화면의 캐릭터 선반** | SillyTavern이 이미 불러온 캐릭터 배열과 캐릭터 정보 안의 메타데이터만 사용합니다. 채팅 목록을 요청하지 않습니다. |
| **캐릭터를 직접 누른 뒤** | 서랍에 표시할 해당 캐릭터의 채팅 파일명만 요청합니다. |
| **Folio가 가져오거나 분석하지 않는 정보** | 채팅 JSONL 내용, 메시지 미리보기, 채팅별 통계, 파일 크기와 시각 정보입니다. |

선택한 채팅을 실제로 여는 일은 SillyTavern의 기본 채팅 열기 흐름에 넘깁니다. Folio 자체는 요약을 만들거나 언어 모델을 호출하지 않습니다.

## 💾 저장과 데이터 정리

- 화면 설정, 데스크톱·모바일별 가로 개수, 공통 세로 줄 수, 페이지당 채팅 개수, 캐릭터·채팅 정렬, 고정한 캐릭터와 채팅방, 메모는 SillyTavern의 확장 설정에 저장됩니다. 예전 초상화 크기와 고정 페이지당 초상화 개수 설정값은 롤백을 위해 보존하지만 현재 화면 구성에는 적용되지 않습니다.
- 검색어, 선택한 태그 필터와 현재 페이지는 임시 화면 상태이며 저장되지 않습니다.
- Folio는 채팅 메시지의 사본을 만들거나 별도의 채팅 내용 데이터베이스를 만들지 않습니다.
- **세팅 데이터 정리**는 Folio에 저장된 설정, 정렬 선택, 고정과 메모를 삭제하고 기본값으로 되돌립니다. 캐릭터 카드나 채팅 파일은 삭제하지 않습니다.

---

## Copyright & License

Copyright © 2026 AmbasaS2  
Licensed under the GNU Affero General Public License v3.0.  
https://github.com/AmbasaS2

The full license text is provided in the `LICENSE` file.
