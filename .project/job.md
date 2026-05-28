# requirement
## Show mono project domain files on detail page
#requirements
##wait
## work
## verify
## complete
### [change]Expose mono domain files in project detail
#### rules
- For projects whose type is `mono`, load domain files from the project's `.project/domains` folder.
- Show those domain files on the project detail page.
- Keep code project detail behavior unchanged.
- Preserve request -> init -> plan -> analyze -> build -> check workflow order.
- Increment package.json patch version by 0.0.1.
- Complete targeted verification.
## fail
# problems
- Detail pages currently expose job, type, spec, and drafts only.
- Mono users cannot inspect which domain files exist without browsing the filesystem.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Mono project details include sorted `.project/domains` file summaries.
- Missing domain directories return an empty list without failing detail loading.
- Code project details keep an empty domain file list.
## ui_checklist
- Mono detail pages show a Domains panel with file names and relative paths.
- Non-mono detail pages do not show the Domains panel.
