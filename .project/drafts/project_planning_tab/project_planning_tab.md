---
request: "project.md 에서 기획 section을 가지고 있고 이걸 detail 페이지 내에서 하나의 독립된 탭으로 열어볼수 있게 UI를 구축한다"
summary: "project_planning_tab"
draft_items:
  - id: "planning_data"
    file: "src/server/uiProjectData.ts"
    description: "Expose the planning section from project.md on project detail data."
  - id: "planning_tab_ui"
    file: "app/projects/[id]/page.tsx"
    description: "Render detail content through tabs with a dedicated planning tab."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts"
    - "bunx tsc --noEmit"
    - "bun run lint:imports"
  assertions:
    - "Detail data includes only the planning body from project.md."
    - "Detail page has a tab menu with an independent 기획 tab."
---
# Draft Summary

## Request
project.md 에서 기획 section을 가지고 있고 이걸 detail 페이지 내에서 하나의 독립된 탭으로 열어볼수 있게 UI를 구축한다

## Draft Items
- `planning_data` (src/server/uiProjectData.ts): Expose the planning section from project.md on project detail data.
- `planning_tab_ui` (app/projects/[id]/page.tsx): Render detail content through tabs with a dedicated planning tab.

## Automated Checks
- bun test test/uiProjectData.test.ts
- bunx tsc --noEmit
- bun run lint:imports

## Assertions
- Detail data includes only the planning body from project.md.
- Detail page has a tab menu with an independent 기획 tab.
