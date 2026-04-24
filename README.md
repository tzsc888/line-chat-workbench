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
- `/api/cron/maintenance`: retention cleanup

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
