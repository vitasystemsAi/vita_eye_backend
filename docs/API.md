# VITA EYE — API Contracts

Base URL: `/api/v1` (proxied by the frontend at `http://localhost:3001/api/v1` in development).

## Conventions

**Success envelope**

```json
{ "success": true, "data": { }, "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
```

**Error envelope**

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": [ ] } }
```

| HTTP | `error.code` |
|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST`, `FACE_QUALITY_REJECTED` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED` |
| 403 | `FORBIDDEN`, `CSRF_INVALID` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 423 | `ACCOUNT_LOCKED` |
| 429 | `RATE_LIMITED` |
| 502/503 | `AI_SERVICE_UNAVAILABLE`, `DEPENDENCY_UNAVAILABLE` |

**Authentication**: `vita_at` (access JWT, 15 min) and `vita_rt` (refresh token, 7 days) httpOnly
cookies. **CSRF**: every non-GET request must send header `X-CSRF-Token` equal to the
`vita_csrf` cookie. **Pagination**: `?page=1&pageSize=20&sort=field&order=asc|desc`.

## Authentication

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| POST | `/auth/login` | public, rate-limited | `{ email, password }` → `{ user }`, sets cookies |
| POST | `/auth/logout` | user | revokes refresh token, clears cookies |
| POST | `/auth/refresh` | refresh cookie | rotates refresh token |
| GET | `/auth/me` | user | `{ user: { id, name, email, role, permissions[], organization } }` |
| POST | `/auth/forgot-password` | public, rate-limited | `{ email }` → always 200 (no enumeration) |
| POST | `/auth/reset-password` | public, rate-limited | `{ token, password }` |
| GET | `/auth/csrf` | public | issues `vita_csrf` cookie |

## Persons (registered people)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/persons` | `persons:view` | `?search&status&enrollmentStatus&department&page…` |
| POST | `/persons` | `persons:manage` | `{ personName, referenceId, department?, status? }` |
| GET | `/persons/:id` | `persons:view` | includes template metadata (never embeddings) + enrollment history |
| PATCH | `/persons/:id` | `persons:manage` | partial update |
| POST | `/persons/:id/enroll` | `persons:enroll` | `multipart/form-data`: `images[]` (1–5 JPEG/PNG ≤ 5 MB), `legalBasis`, `consentReference`, `consentConfirmed=true`, `replaceExisting?` → per-image quality report |
| POST | `/persons/:id/deactivate` | `persons:manage` | removes person from the active gallery |
| POST | `/persons/:id/activate` | `persons:manage` | |
| DELETE | `/persons/:id` | `persons:delete` | soft-deletes person, hard-deletes templates (transaction) |

## Cameras

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/cameras` | `cameras:view` | site-scoped; `?site&location&status&type` |
| POST | `/cameras` | `cameras:manage` | `{ cameraName, cameraType, location, site?, streamUrl?, username?, password?, schedule?, samplingFps? }` |
| GET | `/cameras/:id` | `cameras:view` | credentials never returned (`hasCredentials: true`) |
| PATCH | `/cameras/:id` | `cameras:manage` | |
| DELETE | `/cameras/:id` | `cameras:manage` | only if no events, otherwise deactivate |
| POST | `/cameras/:id/test-connection` | `cameras:manage` | AI service opens stream and grabs one frame |
| POST | `/cameras/:id/start-monitoring` | `cameras:monitor` | RTSP/MJPEG: starts AI stream worker; BROWSER: enables frame ingest |
| POST | `/cameras/:id/stop-monitoring` | `cameras:monitor` | |

## Detection events

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/events` | `events:view` | `?type=KNOWN,UNKNOWN&reviewStatus&cameraId&site&from&to&search&page&sort` |
| GET | `/events/export` | `events:export` | same filters + `format=csv\|xlsx\|pdf`, `images=true\|false` (needs `evidence:view`; max 500 rows), `tzOffset` (minutes east of UTC) → CSV, ZIP (CSV + images), Excel with embedded images, or PDF report (audited) |
| GET | `/events/:id` | `events:view` | camera, person (permitted fields), notes, evidence metadata |
| POST | `/events/:id/acknowledge` | `events:review` | |
| POST | `/events/:id/investigate` | `events:review` | |
| POST | `/events/:id/notes` | `events:review` | `{ note }` |
| POST | `/events/:id/resolve` | `events:review` | `{ resolution, note? }` |
| POST | `/events/:id/reopen` | `events:review` | |
| GET | `/evidence/:id/url` | `evidence:view` | → `{ url, expiresAt }` (signed, 60 s, audited) |
| GET | `/evidence/download?token=` | signed token | streams decrypted image |

## Dashboard & notifications

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard/summary` | `dashboard:view` | counts from MySQL |
| GET | `/dashboard/trends` | `dashboard:view` | `?days=7` daily counts per type + camera health |
| GET | `/dashboard/activity` | `dashboard:view` | recent events + audit activity |
| GET | `/notifications` | user | own notifications (in-app), `?unread=true` |
| POST | `/notifications/:id/read` | user | |
| POST | `/notifications/read-all` | user | |
| GET | `/notifications/settings` | `notifications:view` | channels, recipients, cooldowns |
| PATCH | `/notifications/settings` | `notifications:manage` | |
| GET | `/notifications/logs` | `notifications:view` | delivery history (all channels) |
| POST | `/notifications/test` | `notifications:manage` | real test send to current user on enabled channels |
| POST | `/notifications/devices` | user | register FCM token `{ token }` |

## Administration

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/users` | `users:view` | |
| POST | `/users` | `users:manage` | `{ name, email, password, role, siteScope? }` |
| PATCH | `/users/:id` | `users:manage` | role/status/name/siteScope/password |
| GET | `/roles` | `users:view` | roles + permissions |
| GET | `/audit-logs` | `audit:view` | `?action&entityType&userId&from&to` |
| GET | `/settings` | `settings:view` | recognition thresholds, cooldowns, retention, model info |
| PATCH | `/settings` | `settings:manage` | |
| GET | `/health` | public | liveness (`status`) |
| GET | `/health/details` | `settings:view` | MySQL, Redis, AI service, queues, model versions |

## Platform (VITA Systems operators)

Separate session: `POST /platform/auth/login` sets the httpOnly `vita_pa` cookie (path `/api/v1/platform`,
JWT audience `vita-eye-platform`, `PLATFORM_SESSION_TTL_HOURS`). Logout bumps the admin's token version,
revoking every platform session. The first admin is seeded from `PLATFORM_ADMIN_*` in `.env`. Every action
below is written to `platform_audit_logs`, and client-side effects are also written to the organization's
own audit trail.

Operator workflows are in [PLATFORM_ADMIN.md](PLATFORM_ADMIN.md). Passwords are Argon2id hashes. There is no
endpoint that returns an existing password.

| Method | Path | Notes |
|---|---|---|
| POST | `/platform/auth/login` | `{ email, password }`; 5 failures lock for 15 min |
| POST | `/platform/auth/logout` | |
| GET | `/platform/auth/me` | |
| POST | `/platform/auth/forgot-password` | public; always the same message; emails a 30-minute link |
| POST | `/platform/auth/reset-password` | public; `{ token, password }`; single use; revokes sessions |
| GET | `/platform/features` | catalogue: key, label, category, supported, legal note |
| GET | `/platform/plans` | Starter, Professional, Enterprise limits and included features |
| GET | `/platform/dashboard` | `?from&to` counts, storage, cameras, recent activity |
| GET | `/platform/organizations` | `?q&status&page&pageSize` |
| POST | `/platform/organizations` | register + provision. Returns a one-time setup link only when email was not sent |
| GET | `/platform/organizations/:id` | profile, features, cameras (no stream secrets), detections, users, retention, audit |
| GET | `/platform/organizations/:id/detections` | `?page&from&to&cameraId&eventType&reviewStatus` |
| PATCH | `/platform/organizations/:id` | profile, plan, features, retention, limits; applies on the next request |
| POST | `/platform/organizations/:id/provision/retry` | same organization and database name; only while `FAILED` |
| POST | `/platform/organizations/:id/account` | `{ action, reason?, holdType? }` activate, suspend, hold, reactivate, deactivate, archive |
| POST | `/platform/organizations/:id/holds/:holdId/release` | releases a legal or investigation hold |
| POST | `/platform/organizations/:id/credentials/reset` | `{ confirmPassword }`; emails a setup link; does not return the old password |
| POST | `/platform/organizations/:id/impersonate` | `{ userId?, purpose? }`; `LIVE_PREVIEW` or `CONSOLE` |
| GET | `/platform/audit-logs` | `?organizationId&limit&page` |

**Database per organization.** Registering an organization creates a MySQL database
`${TENANT_DB_PREFIX:-<DB_NAME>_org_}<slug>_<hex>` using `DB_ADMIN_USER` (or `DB_USER`), runs every
organization-schema migration on it, and copies the RBAC catalogue. All tenant tables (users, cameras,
persons, templates, events, evidence, notifications, audit, settings) live there. The primary database keeps
the control plane: organizations, subscriptions, holds, provisioning jobs, retention reports, platform admins,
the login directory, and `platform_audit_logs`. A failed provision keeps the organization row as `FAILED` and
drops only a database that this attempt created. Retry reuses the same name. `npm run db:migrate` upgrades
the primary database, then every tenant database, then the control-plane migrations.

**Features and retention.** Disabled features remove their permissions from every user in the organization.
The retention worker runs at minute 15 of every hour. It deletes by each organization's time zone, grace
period and mode. Dry run only counts. Legal and investigation holds skip destructive cleanup. Backups are
not erased by this job.

## Internal (service-to-service, `X-Internal-Token`, blocked at the edge)

| Method | Path | Caller | Notes |
|---|---|---|---|
| GET | `/internal/gallery/:organizationId` | AI service | decrypted embeddings of ACTIVE + ENROLLED persons |
| POST | `/internal/detections` | AI stream worker | confirmed events + evidence |
| POST | `/internal/cameras/:id/status` | AI stream worker | `{ status, error? }` |

## AI service (`http://ai-service:8000`, `X-Internal-Token`)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | model load status + versions |
| POST | `/v1/enroll/embed` | multipart `image` → `{ embedding[128], quality{…}, bbox }` or 422 with reasons |
| POST | `/v1/frames/process` | multipart `frame` + `meta` JSON (`organizationId, cameraId, galleryVersion, policy`) → `{ faces[], events[] }` |
| POST | `/v1/streams/start` | `{ cameraId, organizationId, url, samplingFps, policy, galleryVersion }` |
| POST | `/v1/streams/stop` | `{ cameraId }` |
| POST | `/v1/streams/test` | `{ url }` → `{ ok, width, height, error? }` |
| GET | `/v1/streams` | running stream workers + health |
| POST | `/v1/policy` | `{ organizationId, policy, galleryVersion }` push updated thresholds to running streams |

## Socket.IO (`/` namespace, cookie-authenticated)

| Direction | Event | Payload |
|---|---|---|
| client → server | `frame` | `{ cameraId, image: ArrayBuffer(JPEG) }` (ack: `{ ok, dropped?, error?, frameSize?, faces?, events?, alerts?: [{ id, eventType: UNKNOWN \| UNCERTAIN }] }`) |
| server → client | `frame:result` | `{ cameraId, faces: [{ bbox, label, similarity, personName?, quality }] }` |
| server → org room | `event:new` | detection event summary |
| server → org room | `event:updated` | `{ id, reviewStatus }` |
| server → org room | `camera:status` | `{ cameraId, status, error? }` |
| server → user room | `notification:new` | notification |
