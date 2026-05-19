---
request: "Fix Next.js Turbopack build error caused by node:fs/promises entering a client chunk through project CRUD imports."
summary: "turbopack_client_boundary"
draft_items:
  - id: "shared_project"
    file: ".project/drafts/turbopack_client_boundary/shared_project_types.yaml"
    description: "Move shared project UI constants and DTO types to a client-safe module and update imports."
checks:
  automated:
    - "bun run build"
  assertions:
    - "Client components import shared project constants and DTO types from src/types.ts."
    - "Server registry functions continue to use shared validation constants."
    - "No client component imports src/server/uiProjectData.ts."
    - "src/cli.ts imports the Provider type used during build type checking."
---

# Draft Summary

## Request
Fix Next.js Turbopack build error caused by `node:fs/promises` entering a client chunk through project CRUD imports.

## Summary
turbopack_client_boundary

## Draft Items
- `shared_project` (.project/drafts/turbopack_client_boundary/shared_project_types.yaml): Move shared project UI constants and DTO types to a client-safe module and update imports.

## Automated Checks
- bun run build

## Assertions
- Client components import shared project constants and DTO types from src/types.ts.
- Server registry functions continue to use shared validation constants.
- No client component imports src/server/uiProjectData.ts.
- src/cli.ts imports the Provider type used during build type checking.
