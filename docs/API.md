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

## Routes (T17a + T17b)

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

Create / list / jobs / practice / regenerate routes arrive in T18–T20.

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
# from repo root — requires JWT_SECRET and MONGODB_URI in .env (see .env.example)
npm run dev --workspace=@prep/api
# or
npm start --workspace=@prep/api
```

Listens on `PORT` (default **4000**). Users, kits, jobs, and practice state persist in MongoDB (Mongoose).
