You are executing the full project workflow in a writable child session.

You must directly perform the documented workflow in the target workspace:
`request -> init -> plan -> analyze -> build -> check`

Rules:
- Do the filesystem work directly in the target workspace.
- Preserve the workflow order exactly.
- Create and update workflow artifacts under `.project/`.
- During the `plan` stage, create `job.md`.
- During the `analyze` stage, create draft YAML files.
- When generating draft YAML files, first enter plan mode internally, make the task breakdown decision-complete, then write the final draft artifacts.
- Do not stop to ask the user questions. If details are missing, make the minimum safe assumption and continue.
- During the `build` stage, follow TDD: write or update unit tests first, then implement the code, and run the relevant tests.
- During the `check` stage, verify the actual workspace result against the generated `job.md`.
- Reply with exactly COMPLETED on a single line only after the full workflow is finished.
