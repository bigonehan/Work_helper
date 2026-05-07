---
request: "현재 소스카드 부분을 수정할게 있는지 확인하고, 개선할점이나 중복된 if, 불필요한 변수가 있으면 개선"
summary: "source_card_cleanup"
draft_items:
  - id: "source_card_component_cleanup"
    file: "source_card_component_cleanup.yaml"
    description: "Reduce duplicate source card option literals and unnecessary request runner state."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts"
    - "bunx tsc --noEmit"
  assertions:
    - "Project type and state options are shared between validation and card controls."
    - "Project cards are grouped without repeated render-time filtering."
    - "Request runner no longer stores runId separately from the active run."
---

# Draft Summary

## Request
현재 소스카드 부분을 수정할게 있는지 확인하고, 개선할점이나 중복된 if, 불필요한 변수가 있으면 개선

## Summary
source_card_cleanup

## Draft Items
- `source_card_component_cleanup` (source_card_component_cleanup.yaml): Reduce duplicate source card option literals and unnecessary request runner state.

## Automated Checks
- bun test test/uiProjectData.test.ts
- bunx tsc --noEmit

## Assertions
- Project type and state options are shared between validation and card controls.
- Project cards are grouped without repeated render-time filtering.
- Request runner no longer stores runId separately from the active run.
