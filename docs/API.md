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

## Routes (T17a)

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

## Not in T17a (documented later)

Kit CRUD, generation jobs, practice, regenerate, and Mongo persistence land in T17b–T20. Those tasks will extend this file. Do not call kit/job routes until they appear here.

---

## Shared error codes (general)

| Code | Typical status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query/params failed schema |
| `NOT_FOUND` | 404 | Unknown route (or later: missing resource) |
| `RATE_LIMITED` | 429 | express-rate-limit window exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Running the API locally

```bash
# from repo root — requires JWT_SECRET in .env (see .env.example)
npm run dev --workspace=@prep/api
# or
npm start --workspace=@prep/api
```

Listens on `PORT` (default **4000**). Users are stored **in memory** until T17b; restart clears accounts.
