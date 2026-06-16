# Repository Rules

- On every commit, increment the `package.json` version by `0.0.1`.
- Keep each version segment to at most two digits.

## Workflow Rules

- All project work must follow this stage order: `request -> init -> plan -> analyze -> build -> check`.
- `request`: the stage where the user's request enters the system.
- `init`: run only once when the project has not been created yet; create `project.md` and run bootstrap here.
- `plan`: for code addition, creation, modification, or improvement requests, create `job.md` here.
- `analyze`: analyze the user's request and the source code, then create `./.project/drafts/{summary}/{summary}.md` and related `draft_item` yaml files here.
- `build`: implement code based on the generated `draft_item` yaml files.
- `check`: perform the final verification using the checklist recorded in the draft markdown bundle.
- When changing this codebase, preserve this workflow and verify that new logic does not bypass or reorder these stages without an explicit reason.
- When an instruction says to use a specific Skill, first inspect the target workspace `Skills/` directory. If a matching Skill document or directory exists there, read and follow that local Skill before falling back to built-in, global, or externally installed Skills.
- For code changes, the `check` stage must include `bun run lint:imports`. If import lint fails or needs configuration work, first read `Skills/import-check/SKILL.md`.
