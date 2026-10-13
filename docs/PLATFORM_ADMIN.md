# Platform administration

The platform console is for VITA Systems operators. It is separate from an organization's own sign-in.

Sign in at `/platform/login`. The seeded account comes from environment variables, not from source code:

```
PLATFORM_ADMIN_NAME=VITA Systems
PLATFORM_ADMIN_EMAIL=info@vitasystems.ai
PLATFORM_ADMIN_PASSWORD=<at least 12 characters>
```

Run `npm run db:setup` inside `backend` after MySQL and Redis are available. The seeder stores an Argon2id hash and does not overwrite an existing platform password. Sessions last `PLATFORM_SESSION_TTL_HOURS` (default 8) and logout invalidates every session for that operator. Five failed logins lock the account for 15 minutes. Login is rate limited.

A platform operator can reset their own password from `/platform/forgot-password`. The email contains a single-use link that expires in 30 minutes. The token is stored only as a SHA-256 hash.

## Registering an organization

The registration form collects the organization name, unique code, email, phone, administrator, plan, time zone, camera limit, storage limit, feature checkboxes and retention settings.

On submit the API:

1. Validates uniqueness of the code, organization email and administrator email.
2. Writes a `PROVISIONING` row in the central database.
3. Creates a dedicated MySQL database named from `TENANT_DB_PREFIX`.
4. Applies the organization schema migrations and reference data.
5. Creates the administrator with a random password hash that is never returned.
6. Marks the organization `ACTIVE` only after those steps succeed.
7. Emails a one-time setup link. If SMTP is not configured, the link is shown once to the platform operator and is not written to the audit log.

If database creation fails, the organization stays as `FAILED` with the error recorded. Retry uses the same organization and database name. It does not create a second organization. Partial databases are dropped before the retry.

`DB_USER` needs `CREATE` and `DROP` on tenant databases, or set `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` for that step. When the admin user differs from `DB_USER`, the app user is granted access to the new database (`DB_APP_USER_HOST`).

## Features and plans

Plans are Starter, Professional and Enterprise. A feature can be enabled only when this deployment supports it and the plan includes it. Face recognition and license-plate recognition carry a legal note; plate recognition and the other detectors that this build does not run cannot be turned on.

Permission checks run in the API. Turning a feature off removes its permissions on the next request. Multi-camera monitoring is also rejected when that feature is off and another camera is already being monitored. Export is rejected when Export and Download is off. No redeploy is required.

## Retention

Each organization has a retention period (presets 1, 3, 7, 15, 30, 60, 90 days, or a custom value within the plan), a grace period and a mode:

- **Dry run** counts eligible rows and deletes nothing.
- **Enforce** permanently deletes eligible detection records, evidence files, expired notifications and audit rows, in batches.

The cutoff is local midnight in the organization time zone, `retention days + grace days` before the current local date. The current local day stays inside the window. A seven-day policy on 13 October makes records timestamped before local midnight on 6 October eligible at the next run.

The worker runs at minute 15 of every hour (UTC). The organization page shows the next run and the last report: processed, deleted, failed, remaining and holds skipped. Deletion is safe to retry.

Suspending an account does not delete data and does not stop retention. A legal or investigation hold pauses destructive cleanup. Records marked with a legal hold, and detections whose review status is Investigating, are also kept.

This job does not erase database backups or object-storage backups. Expire those on their own schedule and document a separate secure-deletion procedure.

Evidence files live under `EVIDENCE_STORAGE_DIR/<organization-id>/` and are encrypted. The storage limit stops new evidence once the prefix reaches the cap. Camera creation stops at the camera limit.

## Account controls

Activate, suspend, hold, reactivate, deactivate and archive are separate from retention.

Suspend, hold, deactivate and archive revoke ordinary sessions, stop network streams and block new logins. Platform "view as" can still open the organization. A hold can be an account hold (cleanup continues) or a legal/investigation hold (cleanup pauses). Releasing the hold does not by itself reactivate the account.

## Camera preview

The organization page does not receive camera passwords, RTSP credentials or permanent stream tokens. Preview opens a short-lived organization session as an authorized user, records `LIVE_FEED_ACCESSED`, and uses the same authenticated monitoring page as the organization. The session ends on logout or expiry.

## Backups and recovery

- Back up the central database and every tenant database. Tenant names are in `organizations.database_name`.
- Back up `EVIDENCE_STORAGE_DIR` with the same frequency. Files are useless without `DATA_ENCRYPTION_KEYS`.
- Keep Redis only as a queue and rate-limit store. It is not the system of record.
- Restore a tenant by creating the database, loading its dump, and confirming `organizations.database_name` still points at it. Then run `npm run db:migrate` so pending migrations apply.
- Test a restore before relying on it. Backup retention is independent of detection retention.

## Operations

- Serve the site over HTTPS. The Nginx template in `infra/nginx` terminates TLS and does not expose internal routes.
- Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` behind that proxy.
- Platform and organization passwords are Argon2id hashes. There is no view-password action.
- Audit rows are in `platform_audit_logs` and in each organization's `audit_logs`. They do not contain passwords or reset tokens.
- Run the API under a process manager such as PM2 so the maintenance worker stays up. Retention and camera health are BullMQ jobs on Redis.
