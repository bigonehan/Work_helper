# info
## name
work_helper
## type
code
## description
Basic web UI with project CRUD and request progress monitoring.
## spec
typescript
## path
/home/tree/project/work_helper
## state
complete
# architecture
name:
next.js app router
# features
- Project list page
- Project detail page
- Responsive shadcn UI
- Persistent project registry CRUD
- Request execution progress monitoring
# rules
- Follow request -> init -> plan -> analyze -> build -> check workflow
- Keep responsive UI support recorded in config
# constraints
- Read project list data from the internal registry
- Read detail artifacts from each registered project path
# domains
## name
project-ui
### states
wait, work, check, complete
### action
list projects, manage projects, view project detail, submit project request
### rules
selected project items open their detail page
request progress is visible from the detail page
### constraints
detail data comes from each project folder's .project artifacts
