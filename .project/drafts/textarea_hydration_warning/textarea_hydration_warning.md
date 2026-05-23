---
request: "Fix Next.js hydration warning caused by an extension-injected data-sharkid attribute on the request textarea."
summary: "textarea_hydration_warning"
draft_items:
  - id: "request_textarea_hydration"
    file: ".project/drafts/textarea_hydration_warning/request_textarea_hydration.yaml"
    description: "Scope hydration warning suppression to the request textarea while preserving controlled input behavior."
checks:
  automated:
    - "bun run build"
  assertions:
    - "The request textarea has suppressHydrationWarning."
    - "The request textarea remains controlled by request state."
    - "package.json version is bumped by 0.0.1."
---

# Draft Summary

## Request
Fix Next.js hydration warning caused by an extension-injected `data-sharkid` attribute on the request textarea.

## Summary
textarea_hydration_warning

## Draft Items
- `request_textarea_hydration` (.project/drafts/textarea_hydration_warning/request_textarea_hydration.yaml): Scope hydration warning suppression to the request textarea while preserving controlled input behavior.

## Automated Checks
- bun run build

## Assertions
- The request textarea has `suppressHydrationWarning`.
- The request textarea remains controlled by request state.
- `package.json` version is bumped by `0.0.1`.
