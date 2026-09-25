# Checkpoint D — laptop + phone manual run

Date: 2026-09-25  
Walked at HEAD after `e1269a3` (`fix(web): add keyboard and 375px question reorder fallbacks`). Middleware `/api` rewrite fix is `823c0c3`.

Ticked after a local run: API (`mongodb-memory-server` via `.loop/start-checkpoint-c-api.mjs`) + `npm run dev --workspace=@prep/web` + fixtures on `:8099`. Keyboard + 375px via Playwright (`msedge`) in `.loop/walk-checkpoint-d.mjs` because Cursor browser tools could not attach a tab. **No physical phone.** 375px CSS/layout was clean (no page overflow).

## Laptop — keyboard only

Tab/Enter implied on every form. Extra keys from `KEYBOARD_CHECKLIST` in `apps/web/src/lib/a11y.ts`.

- [x] Login / register / logout (`Tab`, `Enter`)
- [x] Dashboard create / batch CTAs (`Tab`, `Enter`)
- [x] Create kit form (`Tab`, `Enter`)
- [x] Batch upload (`Tab`, `Enter`)
- [x] Job progress + retry (`Tab`, `Enter`)
- [x] Inline edit + save status (`Tab`; `aria-live` for save)
- [x] Question category tabs (`ArrowLeft`, `ArrowRight`, `Home`, `End`)
- [x] Reorder questions (`Space`, `ArrowUp`, `ArrowDown`)
- [x] Confirm / conflict dialogs (`Tab` trap, `Escape`, `Enter`; focus restores)
- [x] Practice session (`Space`/`Enter` reveal, then `1`–`5`)
- [x] Schedule + coverage hash links (`Tab`, `Enter`)
- [x] Story Bank (`Tab`, `Enter`)
- [x] Skip link reaches `#main`
- [x] Error boundary recovers without a blank page

## Phone — 375px layout

- [x] Header/main gutters stay inside the viewport (`px-4`)
- [x] Toolbars wrap; no horizontal page overflow
- [x] Wide tables (coverage / schedule) scroll inside `overflow-x-auto`
- [x] Auth, dashboard, create, job, builder, practice, Story Bank remain usable
- [x] Dialogs and toasts still keyboard-reachable on a small screen

## After you finish

**Checkpoint D passed** except a real physical phone (375px was clean). Highest-priority regen-while-unsaved and two-tab `409` UI both passed. Fixes during the walk: `/api` must skip page-auth middleware; question Up/Down + 44px taps as dnd fallback.

T28 deploy config is next (no live URL until Vercel/Render/Atlas dashboards are filled).
