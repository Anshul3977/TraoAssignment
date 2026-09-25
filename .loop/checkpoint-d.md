# Checkpoint D — laptop + phone manual run

Date: 2026-09-25  
HEAD when this sheet was written: `d674a2a` (`feat(web): keyboard a11y and 375px layout`). **T28 not started.**

This is an **unchecked** walkthrough sheet. Tick items only after you test them. Do **not** mark Checkpoint D done in `.loop/TASKS.md` until the human review is finished.

How to run: local web + API as in README (`apps/api` + `apps/web`). Keyboard-only on laptop. Phone at **375px** (iPhone SE) or a real device.

## Laptop — keyboard only

Tab/Enter implied on every form. Extra keys from `KEYBOARD_CHECKLIST` in `apps/web/src/lib/a11y.ts`.

- [ ] Login / register / logout (`Tab`, `Enter`)
- [ ] Dashboard create / batch CTAs (`Tab`, `Enter`)
- [ ] Create kit form (`Tab`, `Enter`)
- [ ] Batch upload (`Tab`, `Enter`)
- [ ] Job progress + retry (`Tab`, `Enter`)
- [ ] Inline edit + save status (`Tab`; `aria-live` for save)
- [ ] Question category tabs (`ArrowLeft`, `ArrowRight`, `Home`, `End`)
- [ ] Reorder questions (`Space`, `ArrowUp`, `ArrowDown`)
- [ ] Confirm / conflict dialogs (`Tab` trap, `Escape`, `Enter`; focus restores)
- [ ] Practice session (`Space`/`Enter` reveal, then `1`–`5`)
- [ ] Schedule + coverage hash links (`Tab`, `Enter`)
- [ ] Story Bank (`Tab`, `Enter`)
- [ ] Skip link reaches `#main`
- [ ] Error boundary recovers without a blank page

## Phone — 375px layout

- [ ] Header/main gutters stay inside the viewport (`px-4`)
- [ ] Toolbars wrap; no horizontal page overflow
- [ ] Wide tables (coverage / schedule) scroll inside `overflow-x-auto`
- [ ] Auth, dashboard, create, job, builder, practice, Story Bank remain usable
- [ ] Dialogs and toasts still keyboard-reachable on a small screen

## After you finish

Leave this file’s boxes as you ticked them. Checkpoint D in `.loop/TASKS.md` stays `[ ]` until you decide it passed. Do not start **T28 Deploy**.
