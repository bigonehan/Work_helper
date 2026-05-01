# requirement
## Project CRUD and request progress UI
#requirements
##wait
### [add]Project CRUD and request progress UI
#### rules
- Project page supports CRUD for persistent Project list entries.
- Each registry entry stores type, state, name, and path.
- Each project's own .project folder remains the source of truth for detail artifacts.
- Detail page lets the user submit a request and inspect implementation progress, verification state, and job.md content.
## work
## verify
## complete
- Project CRUD and request progress UI implemented and checked.
## fail
# problems
# check
## logic_checklist
- Project registry data is loaded from .project/project-list.json.
- Detail artifacts are loaded from the selected Project path.
- package.json version is bumped by 0.0.1.
## ui_checklist
- /projects renders responsive project CRUD controls.
- /projects/[id] renders selected project detail content and request progress.
- Mobile viewport check is available through Playwright.
- Playwright e2e creates a project and verifies request-driven todo app generation.
