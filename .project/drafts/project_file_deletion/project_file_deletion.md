---
request: "웹페이지에서 registry 제거와 실제 프로젝트 파일 삭제를 분리하고, 실제 삭제는 안전 확인 후 가능하게 구현해줘."
summary: "project_file_deletion"
draft_items:
  - id: "project_file_delete_api"
    file: ".project/drafts/project_file_deletion/project_file_delete_api.yaml"
    description: "Add summary availability and a safe server-side project folder deletion mode."
  - id: "project_delete_modal"
    file: ".project/drafts/project_file_deletion/project_delete_modal.yaml"
    description: "Replace one-click delete with a modal that separates registry removal from file deletion."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts test/pathDisplay.test.ts"
    - "bun run build"
  assertions:
    - "Registry-only removal keeps the project folder."
    - "File deletion removes the project folder and registry entry."
    - "File deletion requires project metadata and refuses missing folders."
    - "Project cards show missing folder state."
    - "package.json version is bumped by 0.0.1."
---

# Draft Summary

## Request
웹페이지에서 registry 제거와 실제 프로젝트 파일 삭제를 분리하고, 실제 삭제는 안전 확인 후 가능하게 구현해줘.

## Summary
project_file_deletion

## Draft Items
- `project_file_delete_api` (.project/drafts/project_file_deletion/project_file_delete_api.yaml): Add summary availability and a safe server-side project folder deletion mode.
- `project_delete_modal` (.project/drafts/project_file_deletion/project_delete_modal.yaml): Replace one-click delete with a modal that separates registry removal from file deletion.

## Automated Checks
- bun test test/uiProjectData.test.ts test/pathDisplay.test.ts
- bun run build

## Assertions
- Registry-only removal keeps the project folder.
- File deletion removes the project folder and registry entry.
- File deletion requires project metadata and refuses missing folders.
- Project cards show missing folder state.
- `package.json` version is bumped by `0.0.1`.
