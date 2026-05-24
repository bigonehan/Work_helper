# requirement
## Prevent default test suite from hanging on provider integrations
#requirements
##wait
## work
## verify
## complete
### [change]Make real provider integrations opt-in
#### rules
- Identify why `bun test` stalls in `test/manager.integration.test.ts`.
- Keep real tmux/codex integrations available for explicit runs.
- Exclude slow real provider integrations from the default test suite unless an environment variable opts in.
- Make draft dependency-order tests independent from provider-generated draft counts.
- Preserve request -> init -> plan -> analyze -> build -> check workflow order.
- Increment package.json patch version by 0.0.1.
- Complete targeted verification.
## fail
# problems
- Default `bun test` invokes real delegated `codex exec` sessions and can wait for minutes with little output.
- Provider-backed integrations are nondeterministic for routine local/CI verification.
- A CLI unit test depended on inferred draft count, which can vary by provider output.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Default manager and bootstrap integration tests are skipped without the opt-in environment variable.
- Opt-in path remains available for real provider integrations.
- CLI dependency-order test uses deterministic mock drafts.
- Targeted tests pass.
## ui_checklist
- Not applicable; test harness change only.
