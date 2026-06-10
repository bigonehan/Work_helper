# requirement
## code나 mono type에서 사용하는 project.md가 Project.md의 내용을 담도록 수정
#requirements
##wait
## work
## verify
## complete
### [change]Project.md 본문을 프로젝트 메타데이터 생성 결과에 포함
#### rules
- `code`와 `mono` 프로젝트 타입이 사용하는 `project.md` 생성 경로 모두에 적용한다.
- 기존 `# info` 메타데이터 파싱 결과는 유지한다.
- 루트 `project.md`에 기록된 Project.md 본문 섹션을 생성 문서에 포함한다.
- Preserve request -> init -> plan -> analyze -> build -> check workflow order.
- Increment package.json patch version by 0.0.1.
- Complete targeted verification.
## fail
# problems
- 현재 `createProjectMetadataDocument`는 빈 메타데이터 구조만 생성한다.
- `code`와 `mono` 서비스가 렌더링하는 `project.md`가 Project.md 본문 요구/결과/구조/도메인/데이터 설명을 담지 않는다.
# check
## logic_checklist
- package.json version is bumped by 0.0.1.
- code service project metadata includes Project.md guide sections.
- mono service project metadata includes Project.md guide sections.
- Existing project metadata parsing remains compatible.
## ui_checklist
- UI changes are not required for this request.
