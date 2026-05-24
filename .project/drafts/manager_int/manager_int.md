---
summary: manager_int
draft_items:
  - id: opt_in_provider_integration
    file: opt_in_provider_integration.yaml
    description: Gate real provider integrations behind an environment variable and stabilize CLI build tests.
checks:
  automated:
    - bun test test/manager.integration.test.ts
    - bun test test/bootstrap.integration.test.ts
    - bun test test/cli.test.ts test/manager.test.ts test/uiProjectData.test.ts
    - bunx tsc --noEmit
  assertions:
    - Default test runs skip real codex/tmux provider integrations.
    - Developers can still run provider integrations explicitly by setting WORK_HELPER_RUN_PROVIDER_INTEGRATION=1.
    - CLI build ordering test no longer depends on provider-inferred draft count.
---
# Draft Summary
Make real provider integration tests opt-in so routine full test runs do not hang on external codex sessions.

## Draft Items
- opt_in_provider_integration: update test gating, stabilize CLI build test, and verify default execution.
