# requirement
## Project planning tab
- Detail page must expose a tab menu.
- One tab must be `기획`.
- The `기획` tab must show the planning section from `project.md`.

# plan
- Add a detail-data test for extracting the planning section from `project.md`.
- Add a `planningDocument` field to project detail data.
- Replace the single Job content panel with a tabbed detail content component.

# check
- bun test test/uiProjectData.test.ts
- bunx tsc --noEmit
- bun run lint:imports
