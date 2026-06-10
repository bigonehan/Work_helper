---
request: "code나 mono type에서 사용하는 project.md가 Project.md의 내용을 담도록 수정"
summary: "project_md_content"
draft_items:
  - id: "project_md_content"
    file: "project_md_content.yaml"
    description: "code와 mono 프로젝트 메타데이터 생성 시 Project.md 본문을 포함한다"
checks:
  automated:
    - "bun test test/server.project.test.ts test/projectArtifactService.test.ts"
    - "bunx tsc --noEmit"
  assertions:
    - "code project metadata includes the Project.md guide sections"
    - "mono project metadata includes the Project.md guide sections"
---

# Draft Bundle

## Request
code나 mono type에서 사용하는 project.md가 Project.md의 내용을 담도록 수정

## Summary
project_md_content

## Draft Items
- `project_md_content` (project_md_content.yaml): code와 mono 프로젝트 메타데이터 생성 시 Project.md 본문을 포함한다

## Automated Checks
- bun test test/server.project.test.ts test/projectArtifactService.test.ts
- bunx tsc --noEmit

## Assertions
- code project metadata includes the Project.md guide sections
- mono project metadata includes the Project.md guide sections
