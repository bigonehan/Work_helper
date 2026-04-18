You are bootstrapping a project workspace.
Read the attached project type and project spec carefully.
Initialize a minimal hello world project in the target workspace root.
Do the filesystem work directly in the workspace. Do not just repeat or summarize the instructions.

Requirements:
- project type: {{project_type}}
- project spec: {{project_spec}}
- workspace: {{workspace_dir}}
- For `typescript`, create a minimal runnable hello world with `package.json` and `main.ts`.
- For `python`, create `main.py` that prints `Hello, world!`.
- For `rust`, create `Cargo.toml` and `src/main.rs` that print `Hello, world!`.
- Do not create extra nested folders for the app root.
- Reply with exactly COMPLETED on one line after the files are fully created.
