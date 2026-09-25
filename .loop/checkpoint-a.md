# Checkpoint A — crawl review (do not mark TASKS [x] here)

Probe script: `scripts/try-crawl.ts` (crawl + rankLinks + searchDiscussion, no LLM).
Raw logs: `.loop/checkpoint-a/*.log.txt` + `*.json`.
Run date: 2026-09-25. Page budget = 15. Site wall clock cap ≈ 90s (none hit it).

Chosen small startup: **Resend** (`https://resend.com`).

## Results table

| site | hiring page found (URL) | about page | problems |
|---|---|---|---|
| https://posthog.com | https://posthog.com/handbook/people/hiring-process (also design/engineering/exec/etc. hiring subpages) | https://posthog.com/ | Within budget (15 pages, ~15s). Sitemap/frontier left hundreds of `budget_exhausted` URLs (blog/tag noise). One malformed handbook link → `http_error`. |
| https://about.gitlab.com | https://about.gitlab.com/jobs/ai-interview-process/ (also `/jobs/all-jobs/`) | https://about.gitlab.com/ (also `/company/`) | Same-origin only: did **not** follow `handbook.gitlab.com` (common GitLab hiring home). `/jobs/` itself classified **about**, not hiring. Discussion hits were weakly related HN noise. 15 pages / ~15s. |
| https://basecamp.com | *(none)* | https://basecamp.com/ (handbook pages also scored about) | **Missed hiring:** `https://basecamp.com/managers/hiring` stayed in frontier as `budget_exhausted` and was never fetched. Budget spent on handbook/gettingreal pages. 15 pages / ~11s. |
| https://resend.com (small startup) | https://resend.com/handbook/people/whats-the-hiring-process (also `how-we-hire-great-people`) | https://resend.com/ (also `/about`) | `/careers` and individual job posts classified **about**, not hiring (process pages cleared the hiring threshold). Company name from title kept marketing suffix (`Resend · Email for developers`), hurting discussion queries. 15 pages / ~25s. |
| https://this-domain-does-not-exist-xyz.com | *(none)* | *(none)* | Correctly `unreachable=true`; seed + sitemap `network_error`. Discussion empty. ~8s / 16 requests (retries). |
| http://localhost:8099/acme/ | http://localhost:8099/acme/handbook/people/how-we-hire.html | http://localhost:8099/acme/about.html | OK. Robots checked origin `/robots.txt` (404 → fail-open); fixture policy lives at `/acme/robots.txt` and is **not** read by current robots helper. ~5s. |
| http://localhost:8099/quietco/ | *(none — correct)* | *(none — correct)* | **Honesty OK:** homepage stayed `other` (denial copy did not clear hiring threshold). No false hiring page. ~3s. |

## Budget

| site | pages fetched (company) | elapsed | ≤15 pages? | ~30–40s? |
|---|---:|---:|---|---|
| posthog.com | 15 | 15.3s | yes | yes (under) |
| about.gitlab.com | 15 | 14.8s | yes | yes (under) |
| basecamp.com | 15 | 11.2s | yes | yes (under) |
| resend.com | 15 | 25.4s | yes | yes (under) |
| nonexistent domain | 0 | 8.1s | yes | yes |
| localhost acme | 5 | 4.9s | yes | yes |
| localhost quietco | 1 | 3.0s | yes | yes |

No site hit the ~90s wall-clock stop. Large sites still burn the full 15-page budget; leftover frontier is recorded as `budget_exhausted` (often hundreds of URLs from sitemaps).

## Honesty (quietco)

quietco must **not** be reported as having a hiring page. Run result: `hiring=[]`, homepage `kind=other`. No false positive. (Denial text mentioning “careers/hiring handbook” stays under `CONTENT_SCORE_THRESHOLD=8`.)

## Known limitations (observed)

1. **Same-origin / exact host only.** `isSameOriginUnderPrefix` requires identical `origin`. Subdomains such as `handbook.gitlab.com` or `careers.company.com` are never followed from `about.gitlab.com` / `company.com`.
2. **No job-board hosts.** Greenhouse / Lever / Ashby boards are off-origin and skipped entirely.
3. **Client-rendered shells.** If cheerio extracts almost no text, treat as *little extractable content (likely client-rendered)* — not as a confirmed missing hiring page. This run’s company HTML was mostly server-rendered; GitLab blog posts were thin (~78 chars) but above the probe’s “almost empty” bar.
4. **Classification skew.** Pages that are clearly careers hubs (`/jobs`, `/careers`, job posts) often score as **about** because about-signals dominate or hiring content score is below threshold; only explicit “hiring process” copy clears hiring.
5. **Budget vs ranking.** High-signal paths can lose to handbook flood (Basecamp `/managers/hiring` never fetched).
6. **Robots path.** Robots is always origin `/robots.txt`, not path-prefixed fixture robots.
7. **Discussion quality.** Without `SEARCH_API_KEY`, only HN + DuckDuckGo HTML; results can be empty or weakly related.

## Tuning proposals (NOT applied)

1. **Follow registrable-domain subdomains.** Allow crawl expansion to hosts that share the same eTLD+1 as the seed (e.g. `about.gitlab.com` → `handbook.gitlab.com`, `careers.*`). Use the `tldts` package for suffixes like `.co.uk`. Do **not** add the dependency in this checkpoint. If adopted later, log the reason in `PROGRESS.md`.
2. **Allowlist known job-board hosts at depth 1.** When a same-site link points at Greenhouse / Lever / Ashby (e.g. `boards.greenhouse.io/<company>`), fetch that host once at depth ≤ 1 — host allowlist, not hard-coded path templates. Mention in README when implemented; do not edit README in this checkpoint.
3. **Client-rendered detection.** If extracted text length is near-empty after `cleanPage`, record `little extractable content (likely client-rendered)` in `research_log.skipped` / page notes instead of implying a missing hiring page.
4. **Prioritize hiring URL path tokens in the frontier.** Boost pre-fetch `scoreLink` for path segments `careers`, `jobs`, `hiring`, `how-we-hire` so pages like Basecamp `/managers/hiring` beat generic handbook chapters under a 15-page budget.
5. **Down-rank sitemap blog/tag floods.** Cap sitemap enqueue per path prefix or demote `/blog/tags/*`, `/blog/all/*`, category indexes so hiring/about links win early slots.
6. **Treat careers hubs as hiring when path matches.** If path matches `/careers`, `/jobs`, `/job/` and content is non-empty, classify as hiring (or lower `CONTENT_SCORE_THRESHOLD` only for those paths) so Resend `/careers` and GitLab `/jobs/` are not labeled about.
7. **Trim company-name inference for discussion.** Strip trailing marketing slogans after `·` / `|` more aggressively so queries are `Resend interview process`, not the full homepage title.
8. **Optional depth-1 cross-origin for “Careers” anchor text only.** Even without full subdomain policy, if anchor text strongly matches hiring signals and host is a subdomain of the same registrable domain, enqueue once (pairs with proposal 1).

## Review checklist mapping

| Review point | Finding from runs |
|---|---|
| Subdomains | Confirmed same-host only; GitLab handbook subdomain not crawled. Propose `tldts` later + PROGRESS.md note. |
| Job-board hosts | Not followed today; propose Greenhouse/Lever/Ashby host allowlist at depth 1; README mention later. |
| Client-rendered | No major SPA empty shells on these seeds; limitation documented for future cases. |
| Budget | All runs ≤15 pages and well under ~40s (Resend longest at ~25s). |
| Honesty | quietco correctly has **no** hiring page. |

## Files written (uncommitted)

- `scripts/try-crawl.ts`
- `.loop/checkpoint-a.md` (this file)
- `.loop/checkpoint-a/*.log.txt` / `*.json` raw per-site logs

No pipeline code changed. No tuning applied. Checkpoint A left unchecked in TASKS.md. T15 not started. These artifacts left uncommitted for human judgment.
