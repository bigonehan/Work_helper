# requirement
## Project page type panes
#requirements
##wait
### [change]Project page type panes
#### rules
- Project page separates `code` and `mono` projects into distinct panes.
- Project CRUD behavior remains unchanged inside the separated pane layout.
## work
## verify
## complete
- Project page type panes implemented and checked.
## fail
# problems
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- Project cards are filtered into the matching `code` or `mono` pane.
## ui_checklist
- /projects shows separate panes for `code` and `mono` project types.
- Empty type panes show a clear empty state.
