---
request: "detail page내에서는 draft들을 볼수있는 메뉴가 있어야해, 즉 지금까지 어떤 작업을 했는지를 확인할 수 있어야해. 이제 draft.md 구조를 개선할 방법을 찾아봐"
summary: "draft_history_menu"
draft_items:
  - id: "draft_history_data"
    file: "draft_history_data.yaml"
    description: "Expose full draft history and parsed draft bundle metadata on project detail data."
  - id: "draft_history_ui"
    file: "draft_history_ui.yaml"
    description: "Render draft history inside the project detail tab menu."
  - id: "draft_template_version"
    file: "draft_template_version.yaml"
    description: "Refresh draft.md body structure and bump package version."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts test/server.project.test.ts"
    - "bunx tsc --noEmit"
    - "bun run lint:imports"
  assertions:
    - "Completed projects retain draft history on detail data."
    - "Detail data exposes request, raw document, and draft item metadata."
    - "Project detail tab menu includes a Drafts view with selectable draft bundles."
---
# Draft Summary

## Request
detail page내에서는 draft들을 볼수있는 메뉴가 있어야해, 즉 지금까지 어떤 작업을 했는지를 확인할 수 있어야해. 이제 draft.md 구조를 개선할 방법을 찾아봐

## Summary
draft_history_menu

## Work Record
This bundle records the analyze-stage task split, verification commands, and completion assertions for the request.

## Draft Items
- `draft_history_data` (draft_history_data.yaml): Expose full draft history and parsed draft bundle metadata on project detail data.
- `draft_history_ui` (draft_history_ui.yaml): Render draft history inside the project detail tab menu.
- `draft_template_version` (draft_template_version.yaml): Refresh draft.md body structure and bump package version.

## Verification

## Automated Checks
- bun test test/uiProjectData.test.ts test/server.project.test.ts
- bunx tsc --noEmit
- bun run lint:imports

## Assertions
- Completed projects retain draft history on detail data.
- Detail data exposes request, raw document, and draft item metadata.
- Project detail tab menu includes a Drafts view with selectable draft bundles.
