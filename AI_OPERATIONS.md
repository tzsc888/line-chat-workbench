# AI Operations Guide

## Workflow (Current)

The runtime workflow is now:

1. Trigger layer decides whether generation should run.
2. `analysis` always focuses on understanding + generation brief.
3. `generation` produces two suggestions (A stable / B advancing).
4. Human operator makes the final send decision.

Main path:
- `app/api/generate-replies/route.ts` -> `lib/services/generate-replies-workflow.ts`
- `app/api/analyze-customer/route.ts` is analysis-only and does not generate drafts.

## Auto Trigger Rule

Auto generation is allowed only for:
- First inbound text message of a customer (`first inbound text`).

Definition:
- Current message is inbound text.
- No earlier inbound text exists for that customer before this message.

Implementation anchors:
- `lib/inbound/first-inbound.ts`
- `lib/inbound/trigger-policy.ts`
- All ingress paths (`bridge` / `line webhook` / `ingest`) use the same policy and first-message check.

## Manual Trigger Rule

When operator clicks Generate:
- Workflow must attempt `analysis + generation`.
- It must not be blocked by analysis "worth/not worth" semantics.
- On failure, return explicit technical error (for example `generation_empty_reply`).

## Deprecated / Compatibility Notes

The following are retained only for compatibility with old data or old analytics:

- `should_generate_reply`
  - Deprecated as runtime gate.
  - Prompt now explicitly forbids outputting this field.
- `analysis_decided_no_reply`
  - Kept as historical reason code label only.
  - New main workflow does not produce this path.
- review/gate (`reply-review-service`, `shouldRunAiReview`, `finalGateJson`)
  - Not part of new draft generation main path.
  - Historical fields can still be read for old drafts and metrics.

## Prompt Versioning

Prompt source files are under `lib/ai/prompts/`.

Current versions:
- translation: `translation.v1`
- analysis: `analysis-router.v3-no-gating`
- generation: `reply-generation.v2-industry`
- review: `reply-review.v2-industry` (legacy/compat scope)

When prompt changes:
1. Update prompt file.
2. Bump version in `lib/ai/prompts/versions.ts`.
3. Observe `/api/ai/metrics`.

## Pipeline Visibility

Workspace returns message-level pipeline steps:
- `translation`
- `analysis`
- `suggestions`
- `review` (compatibility visibility only; not a generation gate)

Common reason codes:
- `auto_generation_first_inbound_only`
- `reused_existing_draft`
- `job_not_run_yet`
- `job_execution_error`
- plus legacy codes retained for old records.

## Regression Baseline

Run:

```bash
npm test
```

Recommended gate:

```bash
npx tsc --noEmit
```
