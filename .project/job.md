# requirement
## Point detail page domains to type-specific source domain files
#requirements
##wait
## work
## verify
## complete
### [change]Use source domain directories by project type
#### rules
- For `mono` projects, load detail page domain entries from `packages/domains`.
- For `code` projects, load detail page domain entries from `src/domains`.
- Show the Domains panel for both project types, with empty-state behavior when the selected directory is missing.
- Preserve request -> init -> plan -> analyze -> build -> check workflow order.
- Increment package.json patch version by 0.0.1.
- Complete targeted verification.
## fail
# problems
- Domain detail data currently only loads `mono` projects.
- Domain detail data currently reads `.project/domains`, not source domain folders.
- Code project detail pages currently hide the Domains panel.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Mono project details include sorted file summaries under `packages/domains`.
- Code project details include sorted file summaries under `src/domains`.
- Missing domain directories return an empty list without failing detail loading.
## ui_checklist
- Detail pages show a Domains panel for both code and mono projects.
- Domains panel description names the type-specific source directory.
