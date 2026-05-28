---
request: "project type이 mono인경우 detail page에서 domains 파일들이 뭐가있는지를 볼수있게 해줘"
summary: "mono_domain_files"
draft_items:
  - id: "domain_file_data"
    file: "mono_domain_file_data.yaml"
    description: "Load mono project domain file summaries into detail data."
  - id: "domain_file_ui"
    file: "mono_domain_file_ui.yaml"
    description: "Render mono-only domain file list on the detail page."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts"
    - "bun run tsc --noEmit"
  assertions:
    - "Mono details include files under .project/domains."
    - "Missing .project/domains folders do not break detail loading."
    - "Domain panel is conditional on project type mono."
---

# Draft Summary

## Request
project type이 mono인경우 detail page에서 domains 파일들이 뭐가있는지를 볼수있게 해줘

## Summary
mono_domain_files

## Draft Items
- `domain_file_data` (mono_domain_file_data.yaml): Load mono project domain file summaries into detail data.
- `domain_file_ui` (mono_domain_file_ui.yaml): Render mono-only domain file list on the detail page.

## Automated Checks
- bun test test/uiProjectData.test.ts
- bun run tsc --noEmit

## Assertions
- Mono details include files under .project/domains.
- Missing .project/domains folders do not break detail loading.
- Domain panel is conditional on project type mono.
