# Manual Regression Checklist

## 1) New customer first inbound text (auto generate)
Steps:
1. Send first inbound text for a brand-new customer.
2. Open that customer workspace.
Expected:
1. Translation is available (if enabled).
2. Analysis is updated.
3. Two suggestions are generated automatically.
4. No "skip/no reply" semantic appears.

## 2) Same customer second inbound text (no manual generate)
Steps:
1. Send another inbound text for same customer.
2. Do not click Generate.
Expected:
1. No new draft auto-generated.
2. Translation may still run.
3. Workflow reflects first-inbound-only auto generation rule.

## 3) Existing customer manual Generate
Steps:
1. Open customer with latest inbound text.
2. Click "生成回复" once.
Expected:
1. Analysis + generation executed.
2. Two suggestions saved and shown, or explicit technical error returned.
3. No pseudo empty state ("分析成功但没有草稿").

## 4) Refresh Analysis only
Steps:
1. Click "刷新判断".
Expected:
1. Analysis fields refresh.
2. Draft count does not increase.
3. No generation side effect.

## 5) generation_empty_reply error handling
Steps:
1. Simulate backend returning `generation_empty_reply`.
2. Click "生成回复".
Expected:
1. User sees explicit technical error including `generation_empty_reply`.
2. UI does not silently fall back to "当前没有建议草稿".

## 6) Legacy draft compatibility
Steps:
1. Load customer with old draft containing `finalGateJson` / `aiReviewJson`.
2. Trigger a new manual generation.
Expected:
1. Old draft remains readable.
2. New draft can still display normally.
3. Old review/gate data does not block new draft visibility.

## 7) Ingress path consistency
Steps:
1. Trigger inbound via bridge.
2. Trigger inbound via line webhook.
3. Trigger inbound via ingest endpoint.
Expected:
1. All three paths follow identical first-inbound auto generation rule.

## 8) Rapid two inbound messages
Steps:
1. Send two inbound texts quickly for same customer.
Expected:
1. First message may auto-generate.
2. Second message must not be misclassified as first-inbound auto-generate.
3. No inconsistent skip/no-draft state.

## 9) Concurrent manual generate clicks
Steps:
1. Click "生成回复" rapidly (or double click).
Expected:
1. Result is either reused existing draft or newly generated draft.
2. No "analysis succeeded but no draft" pseudo-skip output.
3. No front-end blank/empty swallow on backend error.
