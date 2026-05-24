---
summary: hide_drafts
draft_items:
  - id: hide_completed_drafts
    file: hide_completed_drafts.yaml
    description: Hide draft bundles from UI data once a project is complete.
checks:
  automated:
    - bun test test/uiProjectData.test.ts
  assertions:
    - Completed projects report no active draft bundles.
    - Work-state projects continue to show draft bundles.
---
# Draft Summary
Hide completed project draft bundles from the UI-facing project list and detail data.

## Draft Items
- hide_completed_drafts: update UI project data and tests.
