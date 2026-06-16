---
request: "특정 Skill 사용 지시가 나오면 work_helper 에이전트가 내부 Skills 폴더를 먼저 참조하도록 규칙 추가"
summary: "skills_folder_policy"
draft_items:
  - id: "skills_folder_policy"
    file: "skills_folder_policy.yaml"
    description: "Workflow Rules와 검증 로직에 내부 Skills 폴더 우선 참조 규칙을 추가한다"
checks:
  automated:
    - "bun test test/server.project.test.ts"
    - "bunx tsc --noEmit"
  assertions:
    - "AGENTS.md Workflow Rules documents `Skills/` lookup for specific Skill requests"
    - "getAgentWorkflowRules rejects workflow rules missing the Skill lookup rule"
    - "root Skills directory is represented by a guide document"
---

# Draft Bundle

## Request
특정 Skill 사용 지시가 나오면 work_helper 에이전트가 내부 Skills 폴더를 먼저 참조하도록 규칙 추가

## Summary
skills_folder_policy

## Draft Items
- `skills_folder_policy` (skills_folder_policy.yaml): Workflow Rules와 검증 로직에 내부 Skills 폴더 우선 참조 규칙을 추가한다

## Automated Checks
- bun test test/server.project.test.ts
- bunx tsc --noEmit

## Assertions
- AGENTS.md Workflow Rules documents `Skills/` lookup for specific Skill requests
- getAgentWorkflowRules rejects workflow rules missing the Skill lookup rule
- root Skills directory is represented by a guide document
