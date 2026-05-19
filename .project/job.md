# requirement
## Project type pane row layout
#requirements
##wait
### [change]Stack project type panes vertically
#### rules
- Make the Code and Mono project type panes each occupy a full row.
- Keep the Code pane above the Mono pane.
- Keep project CRUD and request runner behavior unchanged.
- Preserve the `request -> init -> plan -> analyze -> build -> check` workflow order.
## work
## verify
## complete
- Project type pane row layout implemented and checked.
## fail
# problems
- The project type pane section used `xl:grid-cols-2`, placing Code and Mono panes in the same row on wide screens.
- The card grid inside each pane was tuned for half-width panes, so it only expanded to two columns at `2xl`.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Code and Mono panes render in a single-column pane stack at every viewport width.
- Project cards remain filtered by exact project type.
- Existing create, edit, open, save, cancel, and delete controls remain available.
## ui_checklist
- /projects shows the Code pane above the Mono pane.
- Each pane spans the available content width instead of sharing a row.
- Create, edit, open, save, cancel, and delete controls remain available.
