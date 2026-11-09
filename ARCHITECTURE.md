# LinkedIn Job Filter (AI): Architecture

> Purpose of this file: give a developer or an AI assistant enough context to modify the extension safely.
> Keep it in sync with the code. When behavior changes, also add an entry to `CHANGELOG.md`.

## 1. What the extension does

A Chrome extension (Manifest V3) for LinkedIn job search result pages (`https://www.linkedin.com/jobs/...`).
When the user clicks the toolbar icon, it:

1. Collects the job cards on the current results page. It moves to other pages **only** when the panel checkbox
   "Auto next page" is ticked (since 1.8.0); it then continues page after page until Stop is pressed or there is no Next button.
2. Skips cards that are already dismissed or that the user has already applied to.
3. **Keyword filter (no AI):** if a card's title, company or location contains a word from the user's
   comma-separated keyword list, it presses the card's ✕ (Dismiss) button immediately.
4. **Location rule (no AI):** if the card's location is not in the user's "commutable locations" list and is not Remote,
   it presses ✕ immediately.
5. Otherwise it opens the job (clicks the card), reads the details pane ("About the job" and header info),
   and sends it to an AI model (Claude, OpenAI or Gemini; the user chooses) together with the user's resume and hard criteria.
6. If the job matches, it is **saved** at the end of the run (LinkedIn "Save" in the details pane; since 1.7.0, option `saveMatches`).
7. If the AI says `reject` or the score is below the threshold, it presses ✕ on that card.
8. Shows a draggable floating panel with progress and a summary, plus a score badge on every card.

## 2. Files

| File | Runs in | Responsibility |
|---|---|---|
| `manifest.json` | – | MV3 manifest. Content script on `https://www.linkedin.com/*` with `all_frames: true`. Host permissions for LinkedIn and the 3 AI APIs. |
| `settings.js` | background (via `importScripts`) and options page | `LJF_DEFAULTS` (default settings, including default criteria text) and `ljfGetSettings()`, which merges stored settings with the defaults. |
| `background.js` | service worker | Toolbar click handling, the AI provider calls, prompt building, JSON parsing, retries, and the toolbar badge. |
| `content.js` | LinkedIn page (isolated world) | DOM scraping, the main loop, clicking cards and ✕ buttons, the keyword filter, caching, card badges and the floating panel UI. |
| `options.html` / `options.js` | options page | Settings form. Saving also clears `scoreCache`. Includes a "Save & test API" button. |
| `icons/` | – | Toolbar icons (16/48/128 px). |
| `README.md` | – | User-facing install and usage notes (in Persian). |
| `ARCHITECTURE.md` | – | This file. |
| `CHANGELOG.md` | – | Version history. |

## 3. Message flow

```
[toolbar click] → background.js chrome.action.onClicked
    ├─ no API key or no resume → opens the options page
    ├─ not a linkedin.com/jobs URL → toolbar badge "?"
    └─ chrome.tabs.sendMessage(tab, {type:"LJF_TOGGLE"})
         (if no content script is listening → chrome.scripting.executeScript(content.js, allFrames) and retry)

content.js (every frame receives LJF_TOGGLE)
    ├─ running & panel closed → reopen the panel only
    ├─ running & panel open   → request stop
    ├─ frame has no job cards → top frame shows a diagnostic after 1.5 s (only if no other frame started)
    └─ else → run()

run():  for each card (sequential UI work) ──► chrome.runtime.sendMessage({type:"LJF_SCORE", job})
                                                    │ (up to MAX_PARALLEL = 5 in flight)
background.js scoreJob(job) ──► provider API ──► {score, decision, reason}
                                                    │
content.js applyResult() ◄─────────────────────────┘  badge + maybe click ✕

content.js → background: {type:"LJF_STATE", running, progress}  (toolbar badge text)
options.js → background: {type:"LJF_SCORE", job:<fake job>}       ("Save & test API")
```

## 4. Storage (`chrome.storage.local`)

| Key | Shape | Written by | Notes |
|---|---|---|---|
| `settings` | see below | options.js | Read with `ljfGetSettings()` (background/options) or directly (content.js). |
| `scoreCache` | `{ [jobId]: {score, decision, reason, ts} }` | content.js `putCache` | Avoids paying for the same job twice. Cleared whenever settings are saved. |
| `savedIds` | `string[]` (last 5000) | content.js `rememberSaved` | Jobs already saved (by the extension, or found as "Unsave the job"); not reopened for saving again. |
| `dismissedIds` | `string[]` (last 5000) | content.js `rememberDismissed` | Jobs dismissed by the extension **or by the user's own ✕ clicks** (captured by a document-level click listener). Never processed again. |

Page `localStorage` (LinkedIn origin; per-viewer UI conveniences only, wrapped in try/catch):
`ljf-panel-pos` (panel x/y), `ljf-panel-expanded` ("1"/"0") (page localStorage). The "Auto next page" setting is in `chrome.storage.local.autoNext` (boolean; since 1.10.8). `sessionStorage["ljf-autorun"]` holds the next page number only while a Next click is pending (if the page reloads, the new script continues the run from it). The Next button is `button[data-testid="pagination-controls-next-button-visible"]` (fallback: "Next" near the page-number buttons).

### `settings` object

```js
{
  provider: "anthropic" | "openai" | "gemini" | "typesafe",
  models:  { anthropic, openai, gemini },   // model name per provider
  apiKeys: { anthropic, openai, gemini },   // stored only locally
  threshold: 55,        // 55+ keeps "[Transition]" jobs (criteria section 9)        // keep a job only if decision=="match" && score >= threshold
  delaySec: 0,          // pause after opening each job
  dryRun: false,        // score and badge, but never press ✕
  saveMatches: true,   // press "Save" on matching jobs (only if not saved yet)
  blockKeywords: "",    // comma/newline-separated, NOT trimmed (spaces matter); case-insensitive substring match on title/company/location
  commuteLocations: "",  // e.g. "Berlin, Potsdam"; jobs elsewhere must be remote; empty = rule disabled
  criteria: "...",      // hard criteria text sent to the AI
  resume: "..."         // plain-text resume sent to the AI
}
```

## 5. LinkedIn DOM (most fragile part)

LinkedIn changes its markup often. As of 2026-10 the jobs search page uses the **"SDUI" layout** with hashed
class names, so selectors rely on stable attributes:

| Thing | Selector / source | Notes |
|---|---|---|
| Job card | `[componentkey^="job-card-component-ref-<jobId>"]` | **Each card appears twice** (an outer `div[role=button]` and a nested copy with the same key). `getCards()` keeps the outermost one; `applyBadge()` targets the innermost (the visible one). Off-screen cards can be `display:none` (virtualized). |
| Job id | from the `componentkey` above | Also in the URL `?currentJobId=` of the selected job. |
| Dismiss ✕ | `button[aria-label^="Dismiss"]` (e.g. "Dismiss Backend Developer job") | Can sit outside the card element, so it is searched in `cardScope(card)`, the highest ancestor (up to 5 levels) that contains only this one job card. |
| Details "About the job" | `[componentkey="JobDetails_AboutTheJob_<jobId>"]` | Appears empty first, then fills (lazy). `waitStable()` waits until the text length stops changing. Has a "… more" button. |
| Details screen (header) | closest `[data-sdui-screen*="JobDetails"]` | The first ~900 chars hold the title, company, location, workplace type, etc. |
| Title / company | `document.title` = `"Title \| Company \| LinkedIn"` | Updated when a job is selected. |
| Save button | in the details screen: `button[aria-label="Save the job"]` / `"Unsave the job"` (text "Save"/"Saved") | Toggle: `saveJob` clicks only on "Save the job". Missing for jobs already applied to. Toast: "You’ve saved this job." |
| Pagination | button with text "Next" whose parent also holds the page-number buttons ("1 2 3 … Next") | Rendered only after scrolling to the end of the list. Click → SPA navigation, URL `&start=25`; the first card changes after ~1.7 s. |
| Dismissed state | text "We won't show you this job again" in the card scope, or the id in `dismissedIds` | After a page reload LinkedIn hides dismissed jobs entirely. |
| Applied state | card text matches `/Applied\s*(·\|on\b\|\d)/` | Card `innerText` is glued together without spaces ("…applicantsApplied · Posted…"). |
| Card fields (keyword filter) | `cardFields(card)`: leaf text nodes minus `CARD_META` (Promoted, Easy Apply, Viewed, …) | Gives `[title, company, location]` in practice. |

The **classic layout** (`li[data-occludable-job-id]`, `.jobs-search__job-details--container`, etc.) is kept as a fallback
in `getCards`, `cardJobId`, `findCard` and the second branch of `openAndExtract`.

The list once looked like it might be inside an iframe (`/preload/?_bprMode=vanilla`). It is not: the cards are in the top
document. `all_frames: true` and the diagnostic remain as a safety net.

**When LinkedIn breaks the extension:** clicking the icon on a page where no cards are found shows a diagnostic
(counts of iframes, job links and dismiss buttons, plus sample aria-labels) in the panel and in the console (`[LJF]`).
Update `NEW_CARD`, `findDismissButton`, and the selectors in `openAndExtract` first.

## 6. content.js structure

| Section | Key functions |
|---|---|
| Init / guard | `window.__ljfAlive`: if an older copy exists but is disconnected (extension reloaded), the new copy takes over and removes the old panel. |
| Message listener | Handles `LJF_TOGGLE` (see the message flow above). |
| DOM helpers | `getCards`, `cardJobId`, `findCard`, `cardScope`, `getCardsIn`, `isDismissed`, `isApplied`, `findDismissButton`, `currentJobIdFromUrl`, `expandDescription`, `cleanText` (removes Premium upsell noise), `waitStable`, `openAndExtract(card, jobId)` → `{title, company, cardText, detailText}` (detailText ≤ 7000 chars). |
| Dismissed memory | `dismissedIds` Set, `rememberDismissed`, a capture-phase click listener for the user's own ✕ clicks. |
| Keyword filter | `CARD_META`, `cardFields`, `parseBlockKeywords` (split on comma/newline, **not trimmed**, spaces are significant), `keywordHit` (case-insensitive substring on `" " + field + " "`). `parseKeywords` (trimmed, Unicode whole-word regex) is used only for the location list. |
| Location rule | `LJF_DEFAULT_COMMUTE` (a copy of the default list, because settings.js is not loaded in the content script), `COUNTRY_ONLY`, `locationProblem(card, places)`: location = last card field; Remote → OK; country-only → left to the AI; not in the list → dismiss. |
| Cache | `getCache`, `putCache`. |
| Main loop | `run()`: up to 3 passes over the cards (to catch late-rendered cards). For each card: skip (dismissed/applied) → keyword hit → location rule → cached result → `openAndExtract` → fire `LJF_SCORE` without awaiting (`inFlight` set, max 5) → `applyResult`. Waits for all in-flight requests, then saves the matched jobs (`toSave` → `saveJob`, reopening each job). `finish()` resets state. |
| Badges | `badges` Map (jobId → score), `applyBadge` re-applied every 1 s via `setInterval` because LinkedIn re-renders cards. Placed bottom-left under the company logo; green = keep, red = dismiss; tooltip = AI reason. |
| Panel UI | `ui` module: `show`, `visible`, `setRunning` (toggles Stop ↔ ↻ Run again), `reset`, `status`, `stats`, `log` (history kept so it survives close/reopen). Draggable header (`makeDraggable`). The "Details ▾" button expands the panel to show the per-job log (collapsed by default: summary only). |

## 7. background.js structure

- `chrome.action.onClicked`: the entry point (see section 3).
- `scoreJob(job)`: builds the **system prompt** (rules + hard criteria + resume; for Anthropic it is marked
  `cache_control: ephemeral` so the repeated resume is prompt-cached) and the **user message** (title, company,
  card info, details text). Expects JSON `{"score":0-100,"decision":"match"|"reject","reason":"…"}`.
  Final decision = `match` only if the model says match **and** `score >= threshold`.
- `callProvider(s, system, user)`:
  - Anthropic `POST /v1/messages`, `max_tokens: 1024`, header `anthropic-dangerous-direct-browser-access: true`.
  - OpenAI `POST /v1/chat/completions`, `response_format: json_object`; `reasoning_effort: "minimal"` for `gpt-5*`, `"low"` for `o*` models.
  - Gemini `:generateContent`, `responseMimeType: application/json`; `thinkingBudget: 0` for `*flash*` models; thought parts are filtered out.
  - An empty answer throws a retryable error that includes stop/finish reason.
  - **TypeSafe (Jev)** (key routing: `vck_…` → Vercel AI Gateway `/v1/evaluate` with `boolean` instead of `noul`; `sk-or-…` → OpenRouter `/api/v1/systemone`; otherwise `api.typesafe.ai`) `POST https://api.typesafe.ai/v1/systemone`, Bearer key. Not a chat model: `callTypeSafe` sends `state`
    (criteria + resume + job) and two typed questions, `fit` (score, 6 levels → 0–100) and `violation` (noul → reject if ≥ 0.5),
    and converts the answers to the usual `{score, decision, reason}` JSON. Context limit is about 32k tokens. Output tokens are free.
- `callWithRetry` (3 tries, backoff 1.5 s × n) retries HTTP 429/5xx, empty answers and non-JSON answers.
- `parseJson` accepts raw JSON or extracts the first `{…}` block.

## 8. Conventions and gotchas

- Work on the current page only, unless "Auto next page" is ticked (then paginate with the Next button until Stop).
- Never press ✕ in `dryRun` mode.
- Any change to resume or criteria must invalidate `scoreCache` (saving the options page does this).
- `chrome.storage` and API keys stay local; no other network calls besides the selected AI provider.
- After editing the extension: reload it in `chrome://extensions` **and** refresh the LinkedIn tab once.
- Testing without spending API credits: inject `content.js` into a page with a stubbed `window.chrome`
  (`runtime.sendMessage` returning a fake `{ok:true,result:{score,decision,reason}}`) and `dryRun: true`.
- Bump `manifest.json` → `version` and add a `CHANGELOG.md` entry for every change.

## Criteria
The default hard criteria are empty. A commented example and a writing guide are at the top of `settings.js`, and the options page shows an example placeholder.
