---
request: "Monorepo인 경우 detail page에서 Feature와 domains폴더의 내용을 볼수있게 하는데, 이때 소스파일 같은게 아니라 스키마 이름이나 함수명 정도로만 볼수있으면 좋겠어"
summary: "mono_source_symbols"
draft_items:
  - id: "source_symbol_data"
    file: "source_symbol_data.yaml"
    description: "Load monorepo feature/domain source folders as exported symbol summaries."
  - id: "source_symbol_ui"
    file: "source_symbol_ui.yaml"
    description: "Render source symbol summaries on the project detail page without exposing file paths."
checks:
  automated:
    - "bun test test/uiProjectData.test.ts"
    - "bun run tsc --noEmit"
  assertions:
    - "Mono details include packages/features and packages/domains sections."
    - "Sections show exported schema/function/type/class/interface/const names rather than source files."
    - "Missing source folders do not break detail loading."
---

# Draft Summary

## Request
Monorepo인 경우 detail page에서 Feature와 domains폴더의 내용을 볼수있게 하는데, 이때 소스파일 같은게 아니라 스키마 이름이나 함수명 정도로만 볼수있으면 좋겠어

## Summary
mono_source_symbols

## Draft Items
- `source_symbol_data` (source_symbol_data.yaml): Load monorepo feature/domain source folders as exported symbol summaries.
- `source_symbol_ui` (source_symbol_ui.yaml): Render source symbol summaries on the project detail page without exposing file paths.

## Automated Checks
- bun test test/uiProjectData.test.ts
- bun run tsc --noEmit

## Assertions
- Mono details include packages/features and packages/domains sections.
- Sections show exported schema/function/type/class/interface/const names rather than source files.
- Missing source folders do not break detail loading.
