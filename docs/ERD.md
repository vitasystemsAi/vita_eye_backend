# VITA EYE — MySQL ERD (`vita_eye_db`)

All primary keys are UUID (`CHAR(36)`) unless noted. All tenant-owned tables carry
`organization_id` and every query is scoped by it.

```mermaid
erDiagram
    organizations ||--o{ users : has
    organizations ||--o{ registered_persons : owns
    organizations ||--o{ cameras : owns
    organizations ||--o{ detection_events : owns
    organizations ||--o{ audit_logs : scopes
    organizations ||--o{ app_settings : configures
    roles ||--o{ users : assigned
    roles ||--o{ role_permissions : grants
    permissions ||--o{ role_permissions : granted
    users ||--o{ registered_persons : "enrolled_by"
    users ||--o{ notifications : receives
    users ||--o{ refresh_tokens : sessions
    users ||--o{ password_reset_tokens : resets
    users ||--o{ user_devices : "push tokens"
    users ||--o{ event_notes : writes
    registered_persons ||--o{ face_templates : "biometric templates"
    registered_persons ||--o{ detection_events : "matched (nullable)"
    cameras ||--o{ detection_events : produces
    detection_events ||--o{ event_evidence : has
    detection_events ||--o{ notifications : triggers
    detection_events ||--o{ event_notes : annotated

    organizations {
        char36 id PK
        varchar name
        enum status "ACTIVE|SUSPENDED"
        datetime created_at
        datetime updated_at
    }
    roles {
        int id PK
        varchar name UK "SUPER_ADMIN|SECURITY_ADMIN|SECURITY_OPERATOR|AUDITOR"
        varchar description
        datetime created_at
        datetime updated_at
    }
    permissions {
        int id PK
        varchar name UK "e.g. events:review"
        varchar description
    }
    role_permissions {
        int role_id PK,FK
        int permission_id PK,FK
    }
    users {
        char36 id PK
        varchar name
        varchar email UK
        varchar password_hash "argon2id"
        int role_id FK
        char36 organization_id FK
        enum status "ACTIVE|DISABLED"
        json site_scope "null = all sites"
        int failed_login_attempts
        datetime locked_until
        datetime last_login_at
        datetime created_at
        datetime updated_at
    }
    registered_persons {
        char36 id PK
        char36 organization_id FK
        varchar person_name
        varchar reference_id "UK(organization_id, reference_id)"
        varchar department
        enum status "ACTIVE|INACTIVE"
        enum enrollment_status "PENDING|ENROLLED|FAILED|REVOKED"
        varchar legal_basis
        varchar consent_reference
        datetime consent_recorded_at
        char36 enrolled_by FK
        datetime created_at
        datetime updated_at
        datetime deleted_at "soft delete"
    }
    face_templates {
        char36 id PK
        char36 registered_person_id FK
        text encrypted_embedding "AES-256-GCM"
        varchar model_name
        varchar model_version
        float quality_score
        datetime created_at
        datetime updated_at
    }
    cameras {
        char36 id PK
        char36 organization_id FK
        varchar camera_name
        enum camera_type "BROWSER|RTSP|ONVIF|HTTP_MJPEG"
        varchar location
        varchar site
        varchar stream_reference "URL without credentials"
        text encrypted_credentials "AES-256-GCM"
        enum status "ONLINE|OFFLINE|ERROR|DISABLED"
        boolean is_active
        boolean monitoring_enabled
        json schedule
        int sampling_fps_x100
        varchar last_error
        datetime last_connected_at
        datetime created_at
        datetime updated_at
    }
    detection_events {
        char36 id PK
        char36 organization_id FK
        char36 camera_id FK
        char36 registered_person_id FK "nullable"
        enum event_type "KNOWN|UNKNOWN|UNCERTAIN"
        decimal confidence_score "nullable (best cosine similarity)"
        float quality_score
        varchar model_version
        varchar track_id
        datetime event_timestamp
        enum review_status "NEW|ACKNOWLEDGED|INVESTIGATING|RESOLVED"
        char36 acknowledged_by FK "nullable"
        datetime acknowledged_at
        char36 resolved_by FK "nullable"
        datetime resolved_at
        varchar resolution
        datetime created_at
        datetime updated_at
    }
    event_evidence {
        char36 id PK
        char36 event_id FK
        varchar storage_reference "private key, never a public URL"
        enum evidence_type "SNAPSHOT|FACE|CLIP"
        char64 content_hash "sha256 of plaintext"
        datetime created_at
        datetime expires_at
    }
    event_notes {
        char36 id PK
        char36 event_id FK
        char36 user_id FK
        text note
        datetime created_at
    }
    notifications {
        char36 id PK
        char36 user_id FK
        char36 event_id FK "nullable (test notifications)"
        enum channel "IN_APP|EMAIL|PUSH"
        varchar title
        text message
        enum delivery_status "PENDING|SENT|FAILED|SKIPPED"
        int attempts
        varchar last_error
        datetime sent_at
        datetime read_at
        datetime created_at
    }
    audit_logs {
        bigint id PK
        char36 organization_id FK
        char36 user_id FK "nullable (system)"
        varchar action
        varchar entity_type
        varchar entity_id
        varchar ip_address
        json metadata
        datetime created_at
    }
    app_settings {
        char36 organization_id PK,FK
        json settings
        datetime updated_at
    }
    refresh_tokens {
        char36 id PK
        char36 user_id FK
        char64 token_hash UK
        datetime expires_at
        datetime revoked_at
        datetime created_at
    }
    password_reset_tokens {
        char36 id PK
        char36 user_id FK
        char64 token_hash UK
        datetime expires_at
        datetime used_at
        datetime created_at
    }
    user_devices {
        char36 id PK
        char36 user_id FK
        varchar fcm_token UK
        varchar user_agent
        datetime created_at
        datetime updated_at
    }
```

## Key indexes and constraints

| Table | Index / constraint |
|---|---|
| users | `UNIQUE(email)`, `IDX(organization_id)` |
| registered_persons | `UNIQUE(organization_id, reference_id)`, `IDX(organization_id, enrollment_status)` |
| face_templates | `IDX(registered_person_id)`, FK `ON DELETE CASCADE` |
| cameras | `IDX(organization_id, status)` |
| detection_events | `IDX(organization_id, event_timestamp)`, `IDX(camera_id, event_timestamp)`, `IDX(organization_id, event_type, event_timestamp)`, `IDX(organization_id, review_status)`, `IDX(registered_person_id)` |
| event_evidence | `IDX(event_id)`, `IDX(expires_at)` |
| notifications | `UNIQUE(event_id, user_id, channel)` (duplicate-alert guard), `IDX(user_id, created_at)` |
| audit_logs | `IDX(organization_id, created_at)`, `IDX(entity_type, entity_id)` |

## Retention & deletion

| Data | Default retention | Mechanism |
|---|---|---|
| Face templates | Until person deleted / revoked | Hard-deleted in the same transaction as person deletion |
| Soft-deleted persons | 30 days | `retention` job hard-deletes and verifies zero templates remain (`BIOMETRIC_PURGE_VERIFIED` audit) |
| Evidence | 30 days (`evidenceRetentionDays`) | `expires_at`; retention job deletes file + row |
| Detection events | 365 days | Retention job |
| Notifications | 90 days | Retention job |
| Audit logs | 730 days | Retention job |

All retention periods are per-organization settings.
