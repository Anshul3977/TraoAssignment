# API contract

Contract for `apps/api` (Express). The web app (`apps/web`) must build against this document — do not invent routes that are not listed here.

Base URL (local): `http://localhost:4000`  
Through the Next rewrite (browser): same-origin `/api/*` → API (see `apps/web` `next.config`).

All JSON error responses use:

```json
{ "error": { "code": "STRING_CODE", "message": "Human-readable message", "details": {} } }
```

`details` is optional (present for validation failures).

---

## Auth cookie

| Property | Value |
|---|---|
| Name | `session` |
| Contents | JWT (`sub` = user id, `email`) |
| Flags | `HttpOnly`; `SameSite=Lax`; `Secure` when `NODE_ENV=production`; `Path=/` |
| Lifetime | 7 days |
| Set by | `POST /auth/register`, `POST /auth/login` |
| Cleared by | `POST /auth/logout` |

Clients must send cookies (`credentials: 'include'` / same-origin fetch). Do not put the JWT in `Authorization` headers.

### 401 codes on protected routes

| Code | When |
|---|---|
| `UNAUTHENTICATED` | No `session` cookie |
| `SESSION_EXPIRED` | Cookie present but JWT expired, malformed, wrong signature, or user no longer exists |

---

## Routes

### `GET /health`

Public. Liveness check.

**Response `200`**

```json
{ "ok": true }
```

---

### `POST /auth/register`

Public. Creates an account and starts a session.

**Request body**

```json
{ "email": "user@example.com", "password": "at-least-8-chars" }
```

| Field | Rules |
|---|---|
| `email` | Required, trimmed, valid email, max 320 |
| `password` | Required, 8–200 characters |

**Response `201`**

```json
{ "user": { "id": "uuid", "email": "user@example.com" } }
```

Sets `session` cookie.

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed zod checks (`details.issues`) |
| 409 | `EMAIL_TAKEN` | Email already registered |

---

### `POST /auth/login`

Public. Starts a session for an existing account.

**Request body** — same as register.

**Response `200`**

```json
{ "user": { "id": "uuid", "email": "user@example.com" } }
```

Sets `session` cookie.

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed zod checks |
| 401 | `INVALID_CREDENTIALS` | Unknown email or wrong password |

---

### `POST /auth/logout`

Public (idempotent). Clears the session cookie.

**Response `204`** — empty body.

---

### `GET /auth/me`

**Protected.** Returns the current user.

**Response `200`**

```json
{ "user": { "id": "uuid", "email": "user@example.com" } }
```

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` | No session cookie |
| 401 | `SESSION_EXPIRED` | Invalid/expired session |

---

## Kits + generation jobs (T17b + T18)

### Job lifecycle (poll-friendly)

Generation is **asynchronous**. A typical run is on the order of **~90 seconds** (LLM + crawl). Clients should create a job, then **poll** `GET /jobs/:id` until `status` is `done` or `failed`. Leaving the page and returning is safe — progress is persisted on the Job document.

| Behaviour | What happens |
|---|---|
| Double submit (same user + normalised JD + URL + days) | Returns the **existing** job (`200`); does **not** start a second pipeline |
| Mid-run failure | Job `status=failed` with `error.code` / `error.message`; no kit row written |
| Server restart while `running` | On boot, those jobs become `failed` with `error.code=INTERRUPTED` (retryable via `POST /jobs/:id/retry`) |
| Retry | Re-queues the **same** job id (clears steps/error); idempotency key unchanged |

Idempotency key: `sha256(userId + normalisedJD + normalisedURL + days)` where JD whitespace is collapsed and the URL is canonicalised (lowercase host, strip hash, drop trailing slash on non-root paths).

In-process worker runs the same `runPipeline` as the batch CLI. Step events are upserted onto `job.steps` for the timeline UI.

---

### Job object shape

```json
{
  "id": "objectId",
  "userId": "objectId",
  "kitId": "objectId-or-null",
  "status": "queued|running|done|failed",
  "steps": [
    { "step": "extract", "status": "done" },
    { "step": "crawl", "status": "running", "detail": "https://…" }
  ],
  "error": { "code": "EMPTY_JD", "message": "…" },
  "input": { "jd": "…", "company_url": "https://…", "days": 5 },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

`error` is `null` unless `status` is `failed`. `kitId` is set when `status` is `done`.

---

### `POST /kits`

**Protected.** Start a generation job (or return an existing one for the same idempotency key).

**Request body**

```json
{ "jd": "…", "company_url": "https://example.com", "days": 5 }
```

| Field | Rules |
|---|---|
| `jd` | Required, trimmed, non-empty, max 100000 |
| `company_url` | Required, http(s) URL, max 2048 |
| `days` | Integer 1–60 |

**Response `201`** — new job created (usually `queued`).

**Response `200`** — existing job returned (queued / running / done / failed for that key). No second pipeline is started for queued/running/done; a failed job is returned as-is (use retry).

```json
{ "job": { "…": "Job object" } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed zod checks |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |

---

### `POST /kits/batch`

**Protected.** Create jobs for a JSON **array** of `{jd, company_url, days}` (the web app parses uploaded JSON/CSV into this array). Each row uses the same idempotency rules as `POST /kits`.

**Request body**

```json
[
  { "jd": "…", "company_url": "https://a.example", "days": 5 },
  { "jd": "…", "company_url": "https://b.example", "days": 3 }
]
```

Array length 1–50. Each element validated like `POST /kits`.

**Response `200`**

```json
{
  "jobs": [
    { "job": { "…": "Job object" }, "created": true },
    { "job": { "…": "Job object" }, "created": false }
  ]
}
```

`created: false` means an existing job was returned for that row’s idempotency key.

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed zod checks |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |

---

### `GET /kits/:id`

**Protected.** Returns one kit owned by the current user. Queries are always scoped by `userId` — another user's id yields `404 NOT_FOUND` (no existence leak).

**Response `200`**

```json
{
  "kit": {
    "id": "objectId",
    "userId": "objectId",
    "version": 1,
    "title": "Engineer",
    "input": { "jd": "...", "company_url": "https://...", "days": 5 },
    "kit": { "...": "Appendix A kit document" },
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
}
```

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` | No session cookie |
| 401 | `SESSION_EXPIRED` | Invalid/expired session |
| 404 | `NOT_FOUND` | Unknown id, or kit belongs to another user |

---

### `GET /jobs/:id`

**Protected.** Poll job progress. Scoped by `userId` (foreign id → `404 NOT_FOUND`).

**Response `200`**

```json
{ "job": { "…": "Job object" } }
```

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |
| 404 | `NOT_FOUND` | Unknown or not owned |

---

### `POST /jobs/:id/retry`

**Protected.** Re-queue a **failed** job (including `INTERRUPTED`). Clears `steps` / `error` / `kitId`, sets `status=queued`, and enqueues the same document.

**Response `200`**

```json
{ "job": { "…": "Job object" } }
```

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |
| 404 | `NOT_FOUND` | Unknown or not owned |
| 409 | `NOT_RETRYABLE` | Job is not `failed` (still queued/running/done) |

---

### `PATCH /kits/:id`

**Protected.** Apply a batch of edit ops with optimistic concurrency. Each question/flashcard carries `meta: { origin, edited, pinned, updated_at }`; the company brief carries `meta.edited`. Document `version` increments on success.

**Request body**

```json
{
  "baseVersion": 1,
  "ops": [
    { "op": "update", "target": "brief", "set": { "summary": "…" } },
    { "op": "update", "target": "question", "id": "q1", "set": { "prompt": "…", "pinned": true } },
    { "op": "update", "target": "flashcard", "id": "f1", "set": { "front": "…" } },
    { "op": "update", "target": "requirement", "id": "r1", "set": { "text": "…" } },
    { "op": "add", "target": "question", "value": { "prompt": "…", "answer_outline": "…", "category": "technical", "difficulty": 2, "requirement_ids": ["r1"] } },
    { "op": "add", "target": "flashcard", "value": { "front": "…", "back": "…", "requirement_ids": ["r1"] } },
    { "op": "delete", "target": "question", "id": "q2" },
    { "op": "reorder", "target": "questions", "category": "technical", "ids": ["q2", "q1"] },
    { "op": "move", "target": "question", "id": "q1", "category": "behavioural" }
  ]
}
```

| Field | Rules |
|---|---|
| `baseVersion` | Required integer ≥ 1; must equal the kit’s current `version` |
| `ops` | 1–100 ops; see shapes above |

Content edits set `meta.edited=true` and `meta.updated_at`. User-added items get `meta.origin=user`. Deleting a **generated** or **fallback** question appends its normalised prompt to `kit.meta.dismissed` so regenerate will not resurrect it. Schedule `question_ids` are pruned when questions are deleted.

**Response `200`**

```json
{ "kit": { "…": "same shape as GET /kits/:id" } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` / `INVALID_OP` / `INVALID_KIT` | Bad body, bad op, or post-op kit fails validation |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |
| 404 | `NOT_FOUND` | Unknown id, foreign kit, or op target id missing |
| 409 | `VERSION_CONFLICT` | `baseVersion` mismatch — body includes current `kit` |

**409 body**

```json
{
  "error": { "code": "VERSION_CONFLICT", "message": "Kit was modified; reload and retry." },
  "kit": { "…": "current owned kit" }
}
```

---

### `POST /kits/:id/regenerate`

**Protected.** Regenerate one section using the **stored** research bundle (no re-crawl). Merges via `mergeRegenerated` so user / edited / pinned items survive; dismissed prompts are not resurrected. Re-allocates the schedule with `allocateSchedule` when questions change (or when `section=schedule`).

**Request body**

```json
{ "section": "brief", "force": false }
```

```json
{ "section": "questions", "category": "technical" }
```

```json
{ "section": "schedule" }
```

| Field | Rules |
|---|---|
| `section` | `brief` \| `schedule` \| `questions` |
| `category` | Required when `section=questions`: `technical` \| `behavioural` \| `system-design` \| `company-fit` |
| `force` | Optional; for `brief`, override skip when `company_brief.meta.edited` |

Brief regeneration is skipped when the brief is edited unless `force=true` (`briefSkipped: true`, kit unchanged aside from version bump). Missing research bundle on brief regen → `409 MISSING_RESEARCH`.

**Response `200`**

```json
{
  "kit": { "…": "same shape as GET /kits/:id" },
  "briefSkipped": false,
  "questionsChanged": true
}
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` / `INVALID_KIT` | Bad body or post-merge kit invalid |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |
| 404 | `NOT_FOUND` | Unknown or not owned |
| 409 | `MISSING_RESEARCH` | Brief regen needs a stored research bundle |
| 409 | `VERSION_CONFLICT` | Concurrent write — body includes current `kit` |

---

## Practice (T20)

Leitner-style flashcard practice scoped to an owned kit. State lives on `PracticeState` (per user + kit) so sessions reopen after restart (§13).

### Box rules on review

| Confidence | New box |
|---|---|
| 1–2 | Always **1** |
| 3 | Always **2** |
| 4–5 | `min(5, previousBox + 1)` (unseen cards treat previous as **1**) |

### Next-session order

1. Sort **seen** cards by `box` ascending, then `lastConfidence` ascending, then `lastSeenAt` ascending (least recently seen first).
2. **Never-seen** cards (no `lastSeenAt`) are interleaved early: one never-seen card is inserted before each sorted seen card until the never-seen pool is exhausted; any remainder is appended.

### Coverage

A requirement is **covered** when at least one flashcard that lists its id has been reviewed. Requirements with no flashcards stay not-covered.

---

### `POST /kits/:id/practice/review`

**Protected.** Record confidence for one flashcard and update its Leitner box.

**Request body**

```json
{ "flashcardId": "f1", "confidence": 4 }
```

| Field | Rules |
|---|---|
| `flashcardId` | Required string; must exist on the kit |
| `confidence` | Integer 1–5 |

**Response `200`**

```json
{
  "card": {
    "flashcardId": "f1",
    "box": 2,
    "lastConfidence": 4,
    "lastSeenAt": "ISO-8601"
  },
  "flashcard": {
    "id": "f1",
    "front": "…",
    "back": "…",
    "requirement_ids": ["r1"]
  }
}
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed zod checks |
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |
| 404 | `NOT_FOUND` | Unknown/foreign kit, or flashcard id not on kit |

---

### `GET /kits/:id/practice/next`

**Protected.** Ordered queue for the next practice session (full card list).

**Response `200`**

```json
{
  "items": [
    {
      "flashcardId": "f3",
      "front": "…",
      "back": "…",
      "requirement_ids": ["r2"],
      "box": null,
      "lastConfidence": null,
      "lastSeenAt": null
    },
    {
      "flashcardId": "f1",
      "front": "…",
      "back": "…",
      "requirement_ids": ["r1"],
      "box": 1,
      "lastConfidence": 2,
      "lastSeenAt": "ISO-8601"
    }
  ]
}
```

`box` is `null` for never-seen cards.

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |
| 404 | `NOT_FOUND` | Unknown or not owned |

---

### `GET /kits/:id/practice/stats`

**Protected.** Per-requirement covered / not-covered plus totals.

**Response `200`**

```json
{
  "requirements": [
    { "id": "r1", "text": "5+ years with React", "priority": "must", "covered": true },
    { "id": "r2", "text": "Mentors juniors", "priority": "must", "covered": false }
  ],
  "totals": {
    "covered": 1,
    "notCovered": 1,
    "cards": 4,
    "reviewed": 1
  }
}
```

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` / `SESSION_EXPIRED` | Auth |
| 404 | `NOT_FOUND` | Unknown or not owned |

---

## Shared error codes (general)

| Code | Typical status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query/params failed schema |
| `INVALID_OP` | 400 | Op could not be applied (e.g. bad reorder permutation) |
| `INVALID_KIT` | 400 | Kit failed `validateKit` after edit/regenerate |
| `NOT_FOUND` | 404 | Unknown route or missing/foreign resource |
| `NOT_RETRYABLE` | 409 | Retry called on a non-failed job |
| `VERSION_CONFLICT` | 409 | PATCH/regenerate lost the optimistic version race |
| `MISSING_RESEARCH` | 409 | Brief regenerate without a stored research bundle |
| `RATE_LIMITED` | 429 | express-rate-limit window exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

Job `error.code` values when `status=failed` include pipeline codes (`EMPTY_JD`, `LLM_UNAVAILABLE`, `INVALID_INPUT`, `INVALID_KIT`, …) plus `INTERRUPTED` after a restart.

---

## Running the API locally

```bash
# from repo root — requires JWT_SECRET and MONGODB_URI in .env (see .env.example)
npm run dev --workspace=@prep/api
# or
npm start --workspace=@prep/api
```

Listens on `PORT` (default **4000**). Users, kits, jobs, and practice state persist in MongoDB (Mongoose). Set `ALLOW_PRIVATE_HOSTS=true` when generating against local fixture URLs.
