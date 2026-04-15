# Production Hardening Notes

## 1. Secrets
- Do not commit `.env` or `.env.local`.
- Copy `.env.example` into your platform environment manager and fill in real values there.
- Use `APP_LOGIN_USERNAME`, `APP_LOGIN_PASSWORD`, and `APP_AUTH_SECRET` for employee login sessions.
- `CRON_SECRET` protects scheduled message dispatch, automation worker fallback, and maintenance cleanup.

## 2. Database deployment
Use the direct connection string for migrations and the pooled connection string for runtime traffic.

Recommended commands:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build
```

## 3. Cron endpoints
Protected by `CRON_SECRET`:
- `/api/cron/scheduled-messages`
- `/api/cron/automation-jobs`
- `/api/cron/maintenance`

Recommended schedules:
- scheduled messages: every 30 minutes or tighter if needed
- automation jobs fallback: every 5 minutes
- maintenance cleanup: daily

## 4. LINE webhook
`/api/line/webhook` remains public but is protected by:
- LINE signature verification
- webhook event id deduplication

## 5. Runtime
The runtime no longer self-calls internal `/api/*` routes for webhook ingestion or reply generation. Server-side workflows call shared services directly.

## 6. Data retention
The project now includes a retention cleanup path for:
- webhook receipts
- old automation jobs
- stale drafts
- very old selected drafts

Tune retention with these environment variables:
- `RETENTION_LINE_WEBHOOK_RECEIPT_DAYS`
- `RETENTION_AUTOMATION_DONE_DAYS`
- `RETENTION_AUTOMATION_FAILED_DAYS`
- `RETENTION_STALE_DRAFT_DAYS`
- `RETENTION_SELECTED_DRAFT_DAYS`
