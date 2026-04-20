# Stability Notes

## Current Stage

The project is in stabilization and acceptance phase.
Primary focus is regression prevention, not new feature expansion.

## Stable Entry Points

1. Outbound main channel: `app/workbench/outbound/hooks/use-outbound-messages.ts`
2. Workspace projection: `app/workbench/workspace/hooks/use-workspace-messages.ts`
3. Composer domain: `app/workbench/composer/hooks/use-composer.ts`
4. AI assistant domain: `app/workbench/ai-assistant/hooks/use-ai-assistant.ts`
5. Scheduling domain: `app/workbench/scheduling/hooks/use-scheduled-messages.ts`
6. Page assembly: `app/page.tsx`

## AI Workflow Boundary (Current)

- Trigger layer decides run/no-run for generation.
- Analysis prepares context and brief.
- Generation outputs two drafts.
- Human operator decides final send.

Auto generation:
- only for first inbound text.

Manual generation:
- always attempts generation.
- if failed, returns explicit technical error.

## Deprecated Main-Flow Gates

These are retained for compatibility only:

1. `should_generate_reply`
2. `analysis_decided_no_reply`
3. review/gate as generation blocker (`reply-review-service`, `finalGateJson` gating semantics)

## Concurrency Risks Already Guarded

1. Realtime refresh + optimistic reconciliation
2. Fast customer switching + retry context drift
3. First-inbound detection and non-first inbound suppression

## Recommended Debug Order

1. Trigger mismatch: `lib/inbound/trigger-policy.ts`, `lib/inbound/first-inbound.ts`
2. Workflow execution: `lib/services/generate-replies-workflow.ts`
3. Frontend generation UX: `app/workbench/ai-assistant/hooks/use-ai-assistant.ts`
4. Pipeline visibility: `lib/ai/pipeline-status.ts`
