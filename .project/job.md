# requirement
## Config-backed project.md link roots
- Add a configs folder file that defines folder roots by project type.
- Use project.md type and current section to resolve [[file]] references.
- Use the same configured roots for project detail domain/source discovery.

# plan
- Add tests for config parsing and wiki link resolution.
- Add tests for project detail loading with custom configured domain roots.
- Implement config-backed helpers and integrate them into project detail data loading.

# check
- bun test
- bunx tsc --noEmit
- bun run lint:imports
