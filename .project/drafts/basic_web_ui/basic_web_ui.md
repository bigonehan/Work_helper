---
request: "기본적인 web ui를 구축해줘"
summary: "basic_web_ui"
draft_items:
  - id: "project_data"
    file: "project_data.yaml"
    description: "Load local .project artifacts for project list and detail pages."
  - id: "next_shadcn_ui"
    file: "next_shadcn_ui.yaml"
    description: "Build responsive Next.js/shadcn project and detail pages."
checks:
  automated:
    - "bun test"
    - "bunx tsc --noEmit"
    - "bun run build"
    - "bun run check:mobile"
  assertions:
    - "Project page shows local project items."
    - "Project item selection opens a detail page with selected content."
    - "Responsive UI support is recorded in assets/configs/config.yaml."
---

# Draft Summary

## Request
기본적인 web ui를 구축해줘

## Summary
basic_web_ui

## Draft Items
- `project_data` (project_data.yaml): Load local .project artifacts for project list and detail pages.
- `next_shadcn_ui` (next_shadcn_ui.yaml): Build responsive Next.js/shadcn project and detail pages.

## Automated Checks
- bun test
- bunx tsc --noEmit
- bun run build
- bun run check:mobile

## Assertions
- Project page shows local project items.
- Project item selection opens a detail page with selected content.
- Responsive UI support is recorded in assets/configs/config.yaml.
