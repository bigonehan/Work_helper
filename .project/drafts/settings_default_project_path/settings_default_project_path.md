---
request: "설정 메뉴를 추가해서 톱니바퀴아이콘이 있고 그걸 누르면 설정 modal이 뜨게 해줘, 현재 시점에선는 기본 프로젝트 생성 경로 정보를 설정할 수있게 해줘 (새로 프로젝트를 만들때 기본적인 경로로 설정되는값). 이 값들은 configs/ 폴더아래 config.yaml 파일을 만들어서 그걸 참조하고 수정하도록해"
summary: "settings_default_project_path"
draft_items:
  - id: "settings_config"
    file: "settings_config.yaml"
    description: "Move writable app config to configs/config.yaml and expose default project path helpers/API."
  - id: "settings_modal"
    file: "settings_modal.yaml"
    description: "Add gear-triggered settings modal to edit the default project path."
checks:
  automated:
    - "bun test test/server.project.test.ts test/uiProjectData.test.ts"
    - "bunx tsc --noEmit"
  assertions:
    - "configs/config.yaml contains defaultProjectPath"
    - "Project creation with an empty path uses defaultProjectPath/<project-id>"
    - "Settings modal saves through /api/settings"
---
# Draft Summary
## Request
설정 메뉴를 추가해서 톱니바퀴아이콘이 있고 그걸 누르면 설정 modal이 뜨게 해줘, 현재 시점에선는 기본 프로젝트 생성 경로 정보를 설정할 수있게 해줘 (새로 프로젝트를 만들때 기본적인 경로로 설정되는값). 이 값들은 configs/ 폴더아래 config.yaml 파일을 만들어서 그걸 참조하고 수정하도록해

## Summary
settings_default_project_path

## Draft Items
- `settings_config` (settings_config.yaml): Move writable app config to configs/config.yaml and expose default project path helpers/API.
- `settings_modal` (settings_modal.yaml): Add gear-triggered settings modal to edit the default project path.

## Automated Checks
- bun test test/server.project.test.ts test/uiProjectData.test.ts
- bunx tsc --noEmit

## Assertions
- configs/config.yaml contains defaultProjectPath
- Project creation with an empty path uses defaultProjectPath/<project-id>
- Settings modal saves through /api/settings
