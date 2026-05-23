# requirement
## Split project removal and file deletion
#requirements
##wait
## work
## verify
## complete
### [change]Add safe project file deletion from the project page
#### rules
- Keep registry-only removal as a separate action.
- Add a dangerous action that deletes the actual project folder and then removes the registry entry.
- Require explicit confirmation before deleting files.
- Show missing project folders in the list instead of silently removing registry entries.
- Preserve the `request -> init -> plan -> analyze -> build -> check` workflow order.
- Increment `package.json` patch version by `0.0.1`.
- Complete targeted verification.
## fail
# problems
- Current project deletion only removes registry entries.
- If project files disappear outside the app, the list does not make that mismatch clear.
- Actual folder deletion needs server-side path safety checks.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Registry-only removal keeps project files.
- File deletion removes the project folder and registry entry.
- File deletion refuses missing projects and paths without project metadata.
- Missing projects are surfaced through the summary availability field.
- Targeted tests pass.
## ui_checklist
- Delete button opens a confirmation modal.
- Modal offers `Remove from list` and `Delete project files`.
- File deletion requires typing the project name and shows the full path.
- Missing projects show a `Missing` badge and do not offer file deletion.
