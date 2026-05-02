---
request: "project page에서 code 와 mono type이 구분되는 Pane에 위치하게 해줘"
summary: "project_type_panes"
draft_items:
  - id: "project_type_pane_layout"
    file: "project_type_pane_layout.yaml"
    description: "Group projects into separate code and mono panes on the project page."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts"
    - "bunx tsc --noEmit"
  assertions:
    - "Project page renders distinct code and mono panes."
    - "Each project appears only in the pane matching its type."
    - "Create, edit, open, and delete controls remain available."
---

# Draft Summary

## Request
project page에서 code 와 mono type이 구분되는 Pane에 위치하게 해줘

## Summary
project_type_panes

## Draft Items
- `project_type_pane_layout` (project_type_pane_layout.yaml): Group projects into separate code and mono panes on the project page.

## Automated Checks
- bun test test/uiProjectData.test.ts
- bunx tsc --noEmit

## Assertions
- Project page renders distinct code and mono panes.
- Each project appears only in the pane matching its type.
- Create, edit, open, and delete controls remain available.
