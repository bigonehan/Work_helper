# requirement
## Source card cleanup
#requirements
##wait
### [change]Source card and request UI cleanup
#### rules
- Inspect project/source card UI for unnecessary variables, repeated conditionals, and duplicated option literals.
- Keep project CRUD and request runner behavior unchanged.
- Preserve the `request -> plan -> analyze -> build -> check` workflow documents.
## work
## verify
## complete
- Source card cleanup implemented and checked.
## fail
# problems
- Project type/state literals are repeated between data validation and card forms.
- Project cards filter by type inside render, even though the grouping can be prepared once per project list update.
- Request runner keeps a separate `runId` state that duplicates `run.runId`.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Shared project type/state options are used for validation and card controls.
- Request polling still starts from the submitted run and stops when the run is no longer active.
## ui_checklist
- /projects still shows code and mono source card panes.
- Create, edit, open, save, cancel, and delete controls remain available.
