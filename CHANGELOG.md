# Changelog

All notable changes. Newest first. Versions match `manifest.json` → `version`.

## [1.10.6] - 2026-11-06
### Docs
- Criteria guide in `settings.js`: example "Remote jobs" rule (remote only counts if the ad hires from your country or from anywhere / your region).

## [1.10.5] - 2026-11-02
### Changed
- **Already saved jobs are skipped** (not opened, not sent to the AI), like applied and dismissed jobs. Detected from the card's own "Saved" text (`isSavedCard`); gray `🔖 Saved (skipped)` badge.

## [1.10.4] - 2026-11-02
### Fixed
- Jobs you already applied to were still sent to the AI when the card showed "Applied" alone on its own line. `isApplied()`
  now checks each text node for `Applied` / `Applied · …` / `Applied on …` (also "Ansökt"/"Sökt"), without false hits on titles like "Applied AI Engineer".

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
