# requirement
## Settings modal for default project path
#requirements
##wait
## work
## verify
## complete
### [change]Add settings modal and config-backed default project path
#### rules
- Add a gear icon settings entry point on the projects screen.
- Open a settings modal from the gear button.
- Allow editing the default project creation path.
- Store and read the setting from `configs/config.yaml`.
- Use the configured default path when creating a project with an empty path.
- Preserve the `request -> init -> plan -> analyze -> build -> check` workflow order.
- Targeted tests and typecheck completed.
## fail
# problems
- Project creation currently falls back to a hardcoded `.project/workspaces/<project-id>` path.
- Config helpers currently point at `assets/configs/config.yaml`, while the requested writable location is `configs/config.yaml`.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- `configs/config.yaml` exists and includes the default project path setting.
- Empty project path creation uses the configured default path plus the project id.
- Settings API reads and updates the default project path setting.
- Existing project CRUD behavior remains intact.
## ui_checklist
- Projects page has a gear icon button.
- Gear button opens a modal.
- Modal displays and saves the default project creation path.
- Create project path placeholder reflects the configured default path.
