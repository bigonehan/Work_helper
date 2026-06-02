---
request: "project type이 mono인 경우는detail page에서 domains 항목에 있는 domain이 packages/domains를 가리키게 하고 code인 경우는 src/domains내부의 파일을 가리키게 해"
summary: "type_specific_domain_links"
draft_items:
  - id: "type_specific_domain_data"
    file: "type_specific_domain_data.yaml"
    description: "Load domain summaries from packages/domains for mono projects and src/domains for code projects."
  - id: "type_specific_domain_ui"
    file: "type_specific_domain_ui.yaml"
    description: "Render the Domains panel for both project types with the selected source directory."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts"
    - "bun run tsc --noEmit"
  assertions:
    - "Mono details point domain entries at packages/domains."
    - "Code details point domain entries at src/domains."
    - "Missing domain folders do not break detail loading."
---

# Draft Summary

## Request
project type이 mono인 경우는detail page에서 domains 항목에 있는 domain이 packages/domains를 가리키게 하고 code인 경우는 src/domains내부의 파일을 가리키게 해

## Summary
type_specific_domain_links

## Draft Items
- `type_specific_domain_data` (type_specific_domain_data.yaml): Load domain summaries from packages/domains for mono projects and src/domains for code projects.
- `type_specific_domain_ui` (type_specific_domain_ui.yaml): Render the Domains panel for both project types with the selected source directory.

## Automated Checks
- bun test test/uiProjectData.test.ts
- bun run tsc --noEmit

## Assertions
- Mono details point domain entries at packages/domains.
- Code details point domain entries at src/domains.
- Missing domain folders do not break detail loading.
