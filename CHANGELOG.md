# Changelog

All notable changes. Newest first. Versions match `manifest.json` → `version`.

## [1.10.3] - 2026-10-24
First public release.

### Features
- Toolbar button: opens every job on the current LinkedIn results page, sends the ad (plus your resume and hard criteria)
  to an AI model and presses ✕ (dismiss) on jobs that don't fit. Optional **Dry run** (score only).
- AI providers: Claude (Anthropic), OpenAI, Google Gemini and **TypeSafe Jev** (direct TypeSafe key, OpenRouter `sk-or-…`
  key or Vercel AI Gateway `vck_…` key). Scoring requests run in parallel (max 5).
- Rules without AI: **keyword list** (title/company/location) and **commutable locations** (other places are rejected unless remote).
- **Save matching jobs** with LinkedIn's Save button (toggle-safe: never un-saves).
- Jobs rejected before but shown again un-dismissed get ✕ again without an AI call; already applied / dismissed jobs are skipped.
- Card badges explain every decision: `✓ AI 82 · Strong`, `✕ AI 20 · Gap`, `🚫 Keyword: …`, `📍 Location: …`,
  `✕ Rejected before`, `• Applied (skipped)`, `⚠ Error` (full reason in the tooltip).
- Draggable panel: summary, **Details** per-job log, Stop / **↻ Run again**, **Auto next page** (until Stop).
- Score cache (no paying twice), handling of LinkedIn's SDUI layout (duplicate/virtualized cards), classic layout as fallback.
- Hard criteria are empty by default; a commented example and a writing guide are in `settings.js`.
