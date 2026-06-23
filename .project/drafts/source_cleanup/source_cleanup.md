---
request: 현재 소스코드에서 불필요한 중복이나 조건식이 있으면 수정해
summary: source_cleanup
draft_items:
  - id: shared_helpers
    file: shared_helpers.yaml
    description: 공통 helper를 추가하고 반복된 조건식을 교체한다
checks:
  automated:
    - bun test test/textIds.test.ts test/fsUtils.test.ts
    - bun test test/server.project.test.ts test/uiProjectData.test.ts test/debugLogging.test.ts
    - bun test
    - bunx tsc --noEmit
    - bun run lint:imports
  assertions:
    - 기존 slug, 파일 없음 처리, API error 응답 동작이 유지된다
---

# Draft Summary

## Request
현재 소스코드에서 불필요한 중복이나 조건식이 있으면 수정해

## Summary
source_cleanup

## Draft Items
- shared_helpers.yaml: 공통 helper를 추가하고 반복된 조건식을 교체한다

## Automated Checks
- bun test test/textIds.test.ts test/fsUtils.test.ts
- bun test test/server.project.test.ts test/uiProjectData.test.ts test/debugLogging.test.ts
- bun test
- bunx tsc --noEmit
- bun run lint:imports

## Assertions
- 기존 slug, 파일 없음 처리, API error 응답 동작이 유지된다
