# Progress — retrieval lane

## BLOCKED
(none)

## Outside owned folder (needed for T04)
- `packages/core/package.json` + root `package-lock.json`: added dependency `robots-parser` (allowed by project.mdc).
- Did **not** re-export from `packages/core/src/index.ts` (outside retrieval/); callers can import `@prep/core/src/retrieval` path later or T15 can wire the public export.
- This worktree has no `docs/SPEC.md` or `.loop/PROMPT.md`; T04 requirements were read from the sibling main checkout's SPEC §2/§11 + TASKS T04 + project.mdc rule 10.

## 2026-09-25 T04 safeFetch
- Changed: `packages/core/src/retrieval/` (`safeFetch.ts`, `privateAddress.ts`, `hostLimiter.ts`, `robots.ts`, `index.ts`, `safeFetch.test.ts`); dep `robots-parser` in `@prep/core`
- Decisions: SSRF private/loopback/link-local block only when `NODE_ENV=production` unless `ALLOW_PRIVATE_HOSTS=true` or `allowPrivateHosts:true` — because SPEC §11 + rule 10 and the fixture/CLI localhost path; IP literals checked before DNS so redirect-to-127.0.0.1 cannot be bypassed by a custom lookup; robots fail-open when robots.txt missing/unreadable — because a missing policy must not abort research; manual redirects with per-hop re-validation (max 5); 2 MiB stream cap and content-type allowlist before accepting body
- Limitations / follow-ups: not exported from package root `index.ts` yet; per-host 500 ms limiter is process-global (shared intentionally); no honour of robots Crawl-delay beyond our fixed host gap

## 2026-09-25 T05 cleanPage
- Changed: packages/core/src/retrieval/ (cleanPage.ts, cleanPage.test.ts, index.ts); dep cheerio in @prep/core (packages/core/package.json + root package-lock.json)
- Decisions: collect all [href] links (absolutized via 
ew URL(href, pageUrl)) before stripping nav/footer/header/form — because T05 requires chrome links for crawl ranking; prefer main then rticle then ody for text; insert trailing spaces on block tags before whitespace collapse so adjacent elements do not glue words; skip mailto/javascript/data/tel hrefs; soft-cap text at 12_000 chars
- Limitations / follow-ups: still not re-exported from package root index.ts; fragment-only links kept (T06 may penalize); TASKS.md left untouched per lane override (T05 remains [ ] there until a serial sync)

## 2026-09-25 T06 crawl + rankLinks
- Changed: packages/core/src/retrieval/ (rankLinks.ts, crawl.ts, crawl.test.ts, index.ts)
- Decisions: path-prefix confinement from company_url (e.g. /acme/) so sibling fixture hosts stay out; frontier fetched in deterministic score order (hiring/about signals minus penalties); optional sitemap.xml at prefix then origin root; CONTENT_SCORE_THRESHOLD=8 so denial copy like quietco ("no careers/hiring handbook") stays other while real hiring/about pages classify; seed score 1000 so homepage is always fetched first; no new dependencies
- Limitations / follow-ups: still not re-exported from package root index.ts; homepage also appears in its kind bucket; TASKS.md left untouched per lane override (T06 remains [ ] there until serial sync); did not start T07

## 2026-09-25 T07 searchDiscussion
- Changed: packages/core/src/retrieval/ (searchDiscussion.ts, searchDiscussion.test.ts, index.ts)
- Decisions: company name order title → og:site_name → domain label; providers HN Algolia → DuckDuckGo HTML → Brave → Tavily (keyed pair only when SEARCH_API_KEY set, else logged skipped); query APIs use injectable fetch (JSON not on safeFetch allowlist), result pages via safeFetch + cleanPage; keep hits that mention company in title/snippet/url, re-check after fetch; return pages:[] + log entry no_discussion_found when empty — because SPEC §2/§10 and T07 require honest empty discussion
- Limitations / follow-ups: still not re-exported from package root index.ts; TASKS.md left untouched per lane override (T07 remains [ ] until serial sync); no new dependencies; DuckDuckGo HTML is best-effort and layout-fragile; this is the last retrieval-lane task
