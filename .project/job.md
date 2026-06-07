# requirement
## Show monorepo feature and domain symbols on project detail page
#requirements
##wait
## work
## verify
## complete
### [change]Summarize monorepo source folders by exported names
#### rules
- For `mono` projects, load detail page source summaries from `packages/features` and `packages/domains`.
- Show schema names, function names, class names, type names, interface names, and exported constants instead of source file paths or source contents.
- Keep detail loading resilient when either source folder is missing.
- Preserve existing code project domain detail behavior where possible.
- Preserve request -> init -> plan -> analyze -> build -> check workflow order.
- Increment package.json patch version by 0.0.1.
- Complete targeted verification.
## fail
# problems
- Monorepo detail pages currently expose domain file names/paths instead of useful source-level identifiers.
- Monorepo detail pages do not surface `packages/features` content.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Mono project details include source summary sections for `packages/features` and `packages/domains`.
- Source summaries include exported identifiers and do not require source file paths for display.
- Missing feature/domain directories return empty sections without failing detail loading.
## ui_checklist
- Mono detail pages show Feature and Domains source sections.
- Source sections render symbol names and kinds rather than source filenames or code.
