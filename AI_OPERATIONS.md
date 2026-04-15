# AI Operations Guide

## Prompt versioning

Prompt source files are externalized under `lib/ai/prompts/`.

Current versions:
- translation: `translation.v1`
- analysis: `analysis-router.v1`
- generation: `reply-generation.v1`
- review: `reply-review.v1`

When a prompt changes:
1. Update the corresponding prompt file
2. Bump the exported version constant in `lib/ai/prompts/versions.ts`
3. Deploy and observe `/api/ai/metrics`

## Metrics endpoint

Authenticated admins can inspect aggregate AI quality metrics at:

`GET /api/ai/metrics?days=30`

Returned metrics include:
- total drafts
- selected/adopted drafts
- stable vs advancing selection split
- stale rate
- blocked rate
- human-attention rate
- route distribution
- prompt versions

## Minimal regression checks

Run:

```bash
npm test
```

Current coverage intentionally focuses on:
- protocol validator defaults
- state merge helpers
- richer follow-up state handling
- risk-tag merge behavior
