---
request: "code와 mono project는 같은 row가 하니라 하나의 전체 Row를 차지하게 해줘, code pane이 mono pane 위에"
summary: "project_type_pane_row_layout"
draft_items:
  - id: "project_type_pane_row_layout"
    file: "project_type_pane_row_layout.yaml"
    description: "Stack Code and Mono project panes as full-width rows."
checks:
  automated:
    - "bunx tsc --noEmit"
  assertions:
    - "The Code project pane appears above the Mono project pane."
    - "Each project type pane spans the full available row at wide viewport widths."
    - "Project cards remain visible and responsive inside each pane."
---

# Draft Summary

## Request
code와 mono project는 같은 row가 하니라 하나의 전체 Row를 차지하게 해줘, code pane이 mono pane 위에

## Summary
project_type_pane_row_layout

## Draft Items
- `project_type_pane_row_layout` (project_type_pane_row_layout.yaml): Stack Code and Mono project panes as full-width rows.

## Automated Checks
- bunx tsc --noEmit

## Assertions
- The Code project pane appears above the Mono project pane.
- Each project type pane spans the full available row at wide viewport widths.
- Project cards remain visible and responsive inside each pane.
