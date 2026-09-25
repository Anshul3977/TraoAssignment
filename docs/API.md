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

Edit / regenerate / practice routes arrive in T19b–T20.

---

## Shared error codes (general)

| Code | Typical status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query/params failed schema |
| `NOT_FOUND` | 404 | Unknown route or missing/foreign resource |
| `NOT_RETRYABLE` | 409 | Retry called on a non-failed job |
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
