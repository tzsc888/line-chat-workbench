# LINE Chat Workbench

Next.js 16 / React 19 / Prisma / PostgreSQL based chat workbench.

## Core Runtime Rules

1. Inbound messages are ingested first, then automation jobs are queued.
2. Auto reply generation runs only for `first inbound text` per customer.
3. For all other messages, reply generation runs only when operator clicks Generate.
4. Analysis is not a generation gate anymore; it provides understanding + brief.
5. Review/gate no longer blocks draft visibility. Human operator is final reviewer.

## Workflow Shape

- Trigger decides: auto-first-inbound or manual-generate.
- Translation (when needed)
- Analysis
- Generation (two suggestions)
- Draft save + UI display

No runtime path should silently produce "analysis succeeded but no draft" as a policy skip.

## Ingress Paths

The following paths share the same first-inbound decision policy:

- `app/api/bridge/inbound/route.ts`
- `app/api/line/webhook/route.ts`
- `app/api/ingest-customer-message/route.ts`

Shared policy modules:

- `lib/inbound/first-inbound.ts`
- `lib/inbound/trigger-policy.ts`

## Jobs

- `/api/cron/automation-jobs`: inbound automation + outbox processing
- `/api/cron/scheduled-messages`: scheduled message sending
- `/api/cron/maintenance`: retention cleanup + outbound timeout maintenance
- `/api/bridge/scheduled-messages/dispatch`: bridge-first scheduled dispatch (recommended primary path)

Automation translation/reply jobs run through `/api/cron/automation-jobs` and require:

- `ENABLE_LEGACY_CRON_AUTOMATION=true`
- `CRON_SECRET=<shared secret>`

GitHub Actions fallback runner (`.github/workflows/dispatch-automation-jobs.yml`) should provide:

- `APP_BASE_URL=https://<your-vercel-domain>`
- `CRON_SECRET=<same value as Vercel>`

Local note: GitHub Actions does not run in local dev. To test queued inbound auto translation locally, call `/api/cron/automation-jobs` manually with `CRON_SECRET`.

Maintenance cron note:

- `/api/cron/maintenance` requires `CRON_SECRET`.
- Vercel Hobby does not support high-frequency built-in Cron schedules.
- For Hobby deployments, do not configure high-frequency `vercel.json` crons; use an external scheduler instead.
- External scheduler recommendation:
  - `POST https://<your-domain>/api/bridge/scheduled-messages/dispatch`
  - Header: `x-bridge-secret: <BRIDGE_SHARED_SECRET>`
  - Frequency: every 1-2 minutes
  - `GET https://<your-domain>/api/cron/maintenance`
  - Header: `Authorization: Bearer <CRON_SECRET>`
  - Frequency: every 5-10 minutes
- This maintenance endpoint no longer depends on `ENABLE_LEGACY_CRON_MAINTENANCE`.

## Scheduled Dispatch (Bridge-First)

- Primary path: bridge calls `POST /api/bridge/scheduled-messages/dispatch` every 60 seconds.
- Auth header: `x-bridge-secret: <BRIDGE_SHARED_SECRET>`.
- This endpoint does not depend on legacy cron toggles.
- GitHub Actions is fallback only (every 5 minutes by default).

Window rules:

- Minimum lead time: 5 minutes.
- Maximum lead time: 24 hours.

Suggested bridge-side env (bridge repository):

- `WORKBENCH_BASE_URL=https://<your-workbench-domain>`
- `BRIDGE_SHARED_SECRET=<same secret as Vercel>`
- Optional interval: `SCHEDULE_DISPATCH_INTERVAL_MS=60000`

## Setup

1. `npm install`
2. `npm run prisma:generate`
3. `npm run prisma:migrate:deploy`
4. `npm run dev`

## AI Provider Endpoint Notes

- Preferred explicit endpoint:
  - `AI_CHAT_COMPLETIONS_URL=https://<provider-domain>/v1/chat/completions`
- Or set base URL:
  - `EKAN8_BASE_URL=https://<provider-domain>`
  - `EKAN8_BASE_URL=https://<provider-domain>/v1`
  - Runtime auto-resolves to `/v1/chat/completions`.
- Do not use documentation URLs as API endpoints (for example `https://docs.newapi.pro/zh/docs...`).
- Calls use `Authorization: Bearer <token>`.
- Runtime sends `stream: false` explicitly.
- `response_format` is off by default; enable only when channel supports it:
  - `AI_USE_RESPONSE_FORMAT=1`

Provider diagnostic command:

```bash
npm run check:ai
```

## Tests

```bash
npm test
```

Type gate:

```bash
npx tsc --noEmit
```
Deployment trigger note.
