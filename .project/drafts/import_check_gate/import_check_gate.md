---
request: "work_helper 코딩 작업의 check 단계에서 eslint-plugin-import 기반 import 검사를 필수화"
summary: "import_check_gate"
draft_items:
  - id: "import_check_gate"
    file: "import_check_gate.yaml"
    description: "ESLint import 검사 설정과 workflow check 기본 검사를 추가한다"
checks:
  automated:
    - "bun run lint:imports"
    - "bun test test/cli.test.ts test/server.project.test.ts"
    - "bunx tsc --noEmit"
  assertions:
    - "package.json exposes lint:imports"
    - "buildDraftChecks includes bun run lint:imports"
    - "AGENTS.md requires import lint during code-change check"
    - "Skills/import-check provides local guidance"
---

# Draft Bundle

## Request
work_helper 코딩 작업의 check 단계에서 eslint-plugin-import 기반 import 검사를 필수화

## Summary
import_check_gate

## Draft Items
- `import_check_gate` (import_check_gate.yaml): ESLint import 검사 설정과 workflow check 기본 검사를 추가한다

## Automated Checks
- bun run lint:imports
- bun test test/cli.test.ts test/server.project.test.ts
- bunx tsc --noEmit

## Assertions
- package.json exposes lint:imports
- buildDraftChecks includes bun run lint:imports
- AGENTS.md requires import lint during code-change check
- Skills/import-check provides local guidance
