# VITA EYE — Repository Structure & Development Plan

## Repository structure

```
vita-eye/
├── frontend/                 Next.js (App Router) + TypeScript + Tailwind
│   └── src/
│       ├── app/              routes: (auth)/login|forgot-password|reset-password,
│       │                     (app)/dashboard|persons|monitoring|alerts|events|notifications|
│       │                     cameras|users|settings|audit, firebase-messaging-sw.js
│       ├── components/       ui/ primitives, shell/ (sidebar, header, bell), persons/,
│       │                     events/, cameras/, monitoring/ feature components
│       └── lib/              api client (CSRF + refresh aware), auth & socket providers,
│                             hooks, types, formatters, validation, image quality, push
├── backend/                  Express + TypeScript + Sequelize + Socket.IO + BullMQ
│   └── src/
│       ├── config/           env (zod-validated), database, redis, logger
│       ├── controllers/      thin HTTP adapters
│       ├── middleware/       auth, rbac, csrf, validate, rate limit, errors, internal token
│       ├── models/           Sequelize models + associations
│       ├── routes/           /api/v1 routers
│       ├── services/         business logic (auth, persons, enrollment, cameras, ingestion,
│       │                     detections, evidence, notifications, dashboard, audit, settings)
│       ├── validators/       zod schemas
│       ├── jobs/             BullMQ queues & workers (notifications, retention, camera health)
│       ├── sockets/          Socket.IO auth + frame ingest
│       ├── utils/            crypto, errors, pagination, signed URLs, network checks
│       └── db/               Umzug migration/seed runner (uses ../database)
├── ai-service/               FastAPI + OpenCV (YuNet + SFace)
│   ├── app/{api,models,services,pipelines,config}
│   ├── scripts/              download_models.py, download_test_fixtures.py, calibrate.py
│   └── tests/
├── database/
│   ├── migrations/           ordered Sequelize (queryInterface) migrations
│   └── seeders/              roles, permissions, default org, admin user, settings
├── infra/
│   ├── docker/               backend, ai-service and frontend Dockerfiles
│   └── nginx/                edge proxy template (TLS, routing, internal block) + certs/
├── scripts/                  Windows helpers: portable Redis, local Nginx edge test
├── tests/                    smoke-e2e.mjs (API + socket + AI), ui-e2e.mjs (browser)
├── docs/
├── .env.example
├── docker-compose.yml
└── README.md
```

## Model choice

| Stage | Model | License | Notes |
|---|---|---|---|
| Face detection | **YuNet** (`face_detection_yunet_2023mar.onnx`, OpenCV Zoo) | MIT | Fast CPU detector with 5 landmarks, `cv2.FaceDetectorYN` |
| Face recognition | **SFace** (`face_recognition_sface_2021dec.onnx`, OpenCV Zoo) | Apache-2.0 | 128-d embeddings, cosine similarity, `cv2.FaceRecognizerSF` (OpenCV-documented cosine threshold 0.363 on LFW) |

Both run on CPU via OpenCV DNN, so no GPU or proprietary runtime is required. InsightFace
pretrained models were deliberately not used because their weights are licensed for
non-commercial research only.

## Phases & verification gates

| Phase | Deliverables | Verification | Status |
|---|---|---|---|
| 1 Foundation | Repo layout, env schema, docker-compose, backend/AI/frontend scaffolds, migration runner | `npm run build` (backend), `db:create` + `db:migrate` succeed on MySQL 8 | Done |
| 2 Authentication | Argon2id login, JWT cookies, refresh rotation, CSRF, lockout, RBAC, audit logs, forgot/reset password | Unit tests + live login via curl/browser | Done |
| 3 Enrollment | Persons CRUD, enrollment upload/capture, AI embedding, encrypted templates, gallery endpoint, deletion/purge | Enroll real face image, template stored encrypted, never returned | Done |
| 4 Cameras | Camera CRUD, encrypted credentials, SSRF guard, test-connection, schedules, socket frame ingest, RTSP workers, health | Browser camera frames reach AI; RTSP test via AI service | Done |
| 5 Recognition | Quality gates, matching, tracking, temporal voting, unknown memory, cooldowns | pytest suite + live recognition of an enrolled face | Done |
| 6 Notifications | Event persistence first, BullMQ queue, SMTP, FCM, retries/backoff, delivery logs, in-app socket | Notification rows + delivery status after real event | Done |
| 7 Dashboard | All pages wired to APIs | `tests/ui-e2e.mjs` drives every page in Edge with a fake webcam (24 checks) | Done |
| 8 Testing/Deploy | Unit/integration tests, Dockerfiles, compose, Nginx/TLS config, key rotation, calibration tool, docs | `npm test`, `pytest`, `smoke-e2e` (42 checks, also through Nginx/TLS), compose schema validation | Done |
