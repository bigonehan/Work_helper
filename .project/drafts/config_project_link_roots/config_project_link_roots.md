---
request: "project.md wiki links should use project-type-specific folder roots from configs"
summary: "config_project_link_roots"
draft_items:
  - id: "link_root_config"
    file: "link_root_config.yaml"
    description: "Add config-backed project.md section link root resolution and use it for project detail folder discovery."
checks:
  automated:
    - "bun test"
    - "bunx tsc --noEmit"
    - "bun run lint:imports"
  assertions:
    - "project.md [[...]] links resolve through configs/project-link-roots.yaml by project type and section."
    - "domain/source folder discovery uses the same configured roots instead of hardcoded type checks."
---
# Draft Summary

## Request
project.md wiki links should use project-type-specific folder roots from configs.

## Draft Items
- `link_root_config` (link_root_config.yaml): Add config-backed project.md section link root resolution and use it for project detail folder discovery.

## Automated Checks
- bun test
- bunx tsc --noEmit
- bun run lint:imports

## Assertions
- project.md [[...]] links resolve through configs/project-link-roots.yaml by project type and section.
- domain/source folder discovery uses the same configured roots instead of hardcoded type checks.
