# requirement
## Source cleanup
- Remove unnecessary duplicate helper logic and repeated conditions from the current source.
- Keep behavior unchanged.

# plan
- Add focused utility tests first.
- Extract shared id, filesystem, and API response helpers.
- Replace duplicate call sites with the shared helpers.
- Bump the patch version.

# check
- bun test test/textIds.test.ts test/fsUtils.test.ts
- bun test test/server.project.test.ts test/uiProjectData.test.ts test/debugLogging.test.ts
- bun test
- bunx tsc --noEmit
- bun run lint:imports
