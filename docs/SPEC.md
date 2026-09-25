# SPEC — The AI Interview Prep Kit (Trao FS-AI-INTERVIEW-01)

Source of truth: `docs/assignment.pdf`. This is a faithful transcription. **Appendix A and B are EXACT — never rename or drop a field.**

## Overview
User pastes a job description (JD), gives the company website URL, and says how many days until the interview.
The app researches on its own: crawls the company site (what they do, how they hire), searches public discussion of the
company's interview process, combines it with the JD, and generates a kit: company brief, role breakdown, question bank,
flashcards, day-by-day schedule. User can reshape any part and practise in-app.

Preferred stack: Next.js + Tailwind, Node + Express, MongoDB, TypeScript, LLM with a genuine free tier.
Free tiers limit **tokens per minute**. A pipeline that falls over on the first "slow down" is the most common way to lose points.

## User capabilities
- Register/login, see only own kits
- Create a kit from pasted JD + company URL; days until interview
- Multiple roles at once: upload a file of JD-and-company pairs
- Watch generation with visible progress and clear failure states
- Read brief, role breakdown, categorised question bank, flashcards, schedule
- Edit, reorder, add, delete anything
- Regenerate one section without losing edits elsewhere
- Practise flashcards and track coverage

## 1. Auth
Secure register/login/logout with sessions; signed-out visitors can't reach protected pages or endpoints; users read/modify
only their own kits; sensible handling of expired/invalid sessions. No email verification / reset / roles.

## 2. Input and research
- Textarea for JD, field for company URL; batch file upload of pairs
- Crawl company site: what they do and (if exists) how they hire
- Search public discussion of the company's interview process
- Skip and **report** a source that can't be retrieved — never fail the whole run
- Rate-limit requests and back off on failure
- Hiring page location is NOT predictable (/careers, /jobs, handbook, eng blog). **Crawl, rank links, fetch what looks right. A fixed list of paths is not sufficient.**
- Respect robots.txt and site terms; README lists sources used.

## 3. Research and generation (most important)
A sequence of deliberate steps that respond to what was found — NOT one prompt. Must be able to:
- Extract requirements from the JD
- Retrieve and clean an individual page
- Crawl a site and decide which links are worth fetching
- Search public discussion of how the company interviews
- Generate questions **for a given requirement and category**
- Create a schedule from topics and time available
- Compare questions vs requirements to find what's uncovered

Sequencing must be genuine: pasted text needs no retrieval; homepage needs crawling; a found hiring-process page changes
what questions make sense (take-home + system-design round ⇒ different kit than silence). "5 years React" ⇒ technical
questions; "mentoring juniors" ⇒ behavioural — **not from the same call with the same instructions**.

**Deterministic, never the model's job:** (a) allocating topics across days, (b) comparing requirements vs questions to find gaps.

## 4. Second pass
After first draft, code compares questions vs requirements; requirement with no question = gap. System must generate the
missing questions and check again. **A kit shipping with uncovered must-have requirements has failed.** Choose pass count
and stop rule; justify in README.

## 5. Kit structure (EXACT — Appendix A)
- Every requirement has a stable id; every question references the requirement ids it covers.
- Every requirement is `must` or `nice`, from how the posting words it ("required" ≠ "bonus points for").
- Durations are **integer minutes**.

## 6. Builder
- Inline edit any question, answer outline, flashcard, brief
- Reorder questions; move a question between categories
- Add a question/flashcard by hand; delete one
- Regenerate one section: company brief, ONE question category, or the schedule
- Regeneration must not discard edits elsewhere; a user-written or user-edited question **survives regeneration of its category**.
- Represent generated / edited / pinned state; explain in README. "Hardest state problem — we will look closely."

## 7. Practice mode
Step through flashcards one at a time, reveal answer; record confidence per card; show covered vs not; order next session
by least confident (confidence-weighted sort or spaced repetition — pick and defend).

## 8. Schedule
Exactly the requested number of days. Each day: focus, question ids, integer minutes. Every must-have requirement appears
somewhere. Harder + higher-priority material lands earlier. Arithmetic in code, not a prompt.

## 9. Batch entry point (EXACT, MANDATORY)
```
npm run evaluate -- --input <cases.json> --output <kits.json>
```
- Reads array of cases `{id, jd, company_url, days}`
- Runs the **same** retrieval/generation/validation code the app uses
- Uses each case's `days`
- Writes one JSON file in Appendix B shape
- Continues after a case fails, recording the failure
- **5 cases within 15 minutes**, including rate-limit retries
- Credentials from env vars documented in `.env.example`; no setup beyond documented install step
- Company sites may be served from a **local address** (e.g. `http://localhost:8099/acme/`) — don't assume host; follow relative links. Must run from a clean clone.

## 10. Edge cases (handle + describe in README)
- Company URL invalid / 404 / timeout
- No discoverable hiring or about page
- JD is a two-line stub
- Public discussion finds nothing
- Model returns invalid JSON or incomplete kit
- LLM rate-limits or briefly fails
- Same JD + company submitted twice
- 1-day or 60-day schedule

**Inventing requirements is worse than reporting there were few.** Thin JD ⇒ thin kit that says so. Unknown company ⇒ honest brief, not fabricated.

## 11. Security
- Validate URLs before fetching; reject private/loopback addresses **in production**
- Restrict to expected content types and sizes
- Text inside fetched pages (and the JD) is content, **never instructions** (prompt injection is expected)

## 12. Frontend
Next.js + Tailwind; reusable components with sensible state boundaries; clear loading/empty/error states during generation;
reorder/edit feel immediate (no round-trip per keystroke); usable on laptop and phone; keyboard navigable.
Judged on: long-running generation, partial failure, edit in flight, regeneration that must not clobber work.

## 13. Backend
Node; retrieval, extraction, generation, scheduling, persistence clearly separated; validate requests; validate generated
kit against structure before saving; persist enough to reopen and continue; structured error messages.
Consider: generation takes 90 s, fails halfway, triggered twice for same posting. Describe in README.

## 14. Code quality
TS/JS only; clean architecture; meaningful names; **meaningful commits reflecting process**; automated tests for
**schedule allocation, coverage checking, structure validation**.

## Creative feature (optional)
One feature solving a real interview-prep problem (e.g. mock interview, weak-spots report, printable one-pager, compare two postings). Own idea is better. Explain why.

Out of scope: job search, CV parsing, applying, audio/video, payments, team/sharing.

## Deployment (mandatory)
Public frontend and backend, env vars handled securely and documented, free tiers.

## Submission
Public GitHub repo (history reflecting process, batch command works from clean clone), deployment link, 3–4 min video, README.

Video: end-to-end kit creation; research/generation steps + second pass closing a gap; editing/reordering + regeneration preserving edits; practice + schedule; creative feature + one defended design decision.

README must include: overview + stack (justify deviations); setup local + deployed, exact install + batch commands;
LLM provider + model; architecture; retrieval approach + sources; step sequencing + responsibilities; generated/edited/pinned
state representation; schedule allocation; creative feature; key decisions, trade-offs, known limitations.

## Evaluation
Automated 55: requirement extraction (must-haves found, marked correctly, **nothing invented**) 20 · coverage & schedule 15 ·
research & sequencing (site crawled, hiring page sought, discussion searched, categories generated separately, coverage genuinely checked) 10 · robustness (run completes, unreachable sites recorded not fatal, structure valid, tests pass) 10.
Human 45: builder 15 · interaction design 10 · code quality + README reasoning 10 · practice + creative 10.
Test set includes a **two-line JD** and a **company with no hiring page anywhere**. Honest handling counts more than easy cases.

FAQ: `failed` only when no kit at all could be produced. Partially researched = `ok` with gaps recorded honestly. Missing hiring page is not a failure.

## Appendix A — Kit structure (EXACT field names)
```json
{
  "source": { "company": "", "company_url": "", "role": "", "location": "",
              "jd_chars": 0, "researched_at": "", "pages_used": ["https://..."] },
  "company_brief": { "summary": "", "what_they_do": "", "sources": ["https://..."] },
  "role": {
    "title": "", "seniority": "", "responsibilities": [""],
    "requirements": [
      { "id": "r1", "text": "5+ years with React",
        "kind": "technical",      // technical | behavioural | domain
        "priority": "must" }      // must | nice
    ]
  },
  "questions": [
    { "id": "q1", "requirement_ids": ["r1"],
      "category": "technical",    // technical | behavioural | system-design | company-fit
      "prompt": "", "answer_outline": "", "difficulty": 2 }
  ],
  "flashcards": [ { "id": "f1", "front": "", "back": "", "requirement_ids": ["r1"] } ],
  "schedule": { "days_available": 5,
                "days": [ { "day": 1, "focus": "", "question_ids": ["q1"], "minutes": 60 } ] },
  "coverage": { "uncovered_requirement_ids": [], "passes": 2 }
}
```
`difficulty` 1–3. `minutes` integer. Every id stable within a kit. Every schedule `question_ids` entry must reference an existing question.

## Appendix B — Batch I/O
Input:
```json
[ { "id": "case-01", "jd": "Senior Backend Engineer\n\nWe are looking for ...",
    "company_url": "http://localhost:8099/acme/", "days": 5 } ]
```
Output:
```json
{ "version": "1.0", "generated_at": "2026-09-01T09:12:44Z",
  "kits": [
    { "id": "case-01", "status": "ok", "kit": { "...Appendix A..." : "" }, "error": null },
    { "id": "case-04", "status": "failed", "kit": null,
      "error": { "code": "COMPANY_UNREACHABLE", "message": "Company site unreachable after 3 retries." } }
  ] }
```
One entry per input case, keyed by id, any order.
