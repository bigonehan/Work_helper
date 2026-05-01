---
request: "Project page CRUD and Project detail request progress monitoring"
summary: "project_crud_request_ui"
draft_items:
  - id: "project_registry"
    file: "project_registry.yaml"
    description: "Persist project list entries separately from each project folder's .project artifacts."
  - id: "request_progress"
    file: "request_progress.yaml"
    description: "Expose request execution and progress state to the detail page."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts test/server.project.test.ts test/projectManager.test.ts"
    - "bunx tsc --noEmit"
    - "bun run build"
    - "bun run check:mobile"
    - "WORK_HELPER_E2E_WAIT_FOR_COMPLETION=1 bun run check:e2e"
  assertions:
    - "Project page supports create, update, and delete for registry entries."
    - "Detail page shows request run progress, job.md, and verification state."
    - "Playwright can create a project and verify todo app files are generated."
---

# Draft Summary

## Request
Project page CRUD and Project detail request progress monitoring

## Summary
project_crud_request_ui

## Draft Items
- `project_registry` (project_registry.yaml): Persist project list entries separately from each project folder's .project artifacts.
- `request_progress` (request_progress.yaml): Expose request execution and progress state to the detail page.

## Automated Checks
- bun test test/uiProjectData.test.ts test/server.project.test.ts test/projectManager.test.ts
- bunx tsc --noEmit
- bun run build
- bun run check:mobile
- WORK_HELPER_E2E_WAIT_FOR_COMPLETION=1 bun run check:e2e

## Assertions
- Project page supports create, update, and delete for registry entries.
- Detail page shows request run progress, job.md, and verification state.
- Playwright can create a project and verify todo app files are generated.
