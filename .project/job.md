# requirement
## Draft history detail menu
- Project detail pages must include a menu/tab for draft history.
- Users must be able to inspect prior draft bundles to understand what work has been done.
- Completed projects must retain draft history on the detail page.

# plan
- Add failing UI data tests for completed-project draft history and richer draft metadata.
- Expose draft request, raw document, and draft item metadata from detail data.
- Add a Drafts tab to the project detail tab menu with bundle selection and raw draft display.
- Refresh the draft bundle markdown body structure.
- Bump the patch version.

# check
- bun test test/uiProjectData.test.ts test/server.project.test.ts
- bunx tsc --noEmit
- bun run lint:imports
- bun run check (expected external provider failure: integration > gemini returns 2)
