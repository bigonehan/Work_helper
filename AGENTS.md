# Repository Rules

- On every commit, increment the `package.json` version by `0.0.1`.
- Keep each version segment to at most two digits.

## Workflow Rules

- All project work must follow this stage order: `request -> init -> plan -> analyze -> build -> check`.
- `request`: the stage where the user's request enters the system.
- `init`: run only once when the project has not been created yet; create `project.md` and run bootstrap here.
- `plan`: for code addition, creation, modification, or improvement requests, create `job.md` here.
- `analyze`: analyze the user's request and the source code, then create `drafts.yaml` here.
- `build`: implement code based on `drafts.yaml`.
- `check`: perform the final verification.
- When changing this codebase, preserve this workflow and verify that new logic does not bypass or reorder these stages without an explicit reason.
