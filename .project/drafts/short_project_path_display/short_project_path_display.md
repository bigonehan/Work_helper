---
request: "프로젝트 위치는 전체 경로 대신 마지막 두 폴더만 보이고, 프로젝트 이름은 최대 4글자 뒤 ...로 줄이도록 바꿔줘."
summary: "short_project_path_display"
draft_items:
  - id: "compact_project_path"
    file: ".project/drafts/short_project_path_display/compact_project_path.yaml"
    description: "Add a client-safe compact path formatter and use it on project cards."
checks:
  automated:
    - "bun test test/pathDisplay.test.ts"
    - "bun run build"
  assertions:
    - "A path like /home/tree/project/write_new/.write-new/projects/crud-검 displays as /projects/crud..."
    - "A path like a/b/c/d/app displays as d/app."
    - "Project edit forms continue to use the full path value."
    - "package.json version is bumped by 0.0.1."
---

# Draft Summary

## Request
프로젝트 위치는 전체 경로 대신 마지막 두 폴더만 보이고, 프로젝트 이름은 최대 4글자 뒤 `...`로 줄이도록 바꿔줘.

## Summary
short_project_path_display

## Draft Items
- `compact_project_path` (.project/drafts/short_project_path_display/compact_project_path.yaml): Add a client-safe compact path formatter and use it on project cards.

## Automated Checks
- bun test test/pathDisplay.test.ts
- bun run build

## Assertions
- A path like `/home/tree/project/write_new/.write-new/projects/crud-검` displays as `/projects/crud...`.
- A path like `a/b/c/d/app` displays as `d/app`.
- Project edit forms continue to use the full path value.
- `package.json` version is bumped by `0.0.1`.
