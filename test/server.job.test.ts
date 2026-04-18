import { describe, expect, test } from "bun:test";
import {
  RequirementItemKind,
  TaskKind,
  buildTaskDraft,
  classifyRequirementItemKind,
  classifyTaskKind,
  renderJobDocument,
  renderTasksDocument,
} from "../src/server/job";

describe("server job helpers", () => {
  test("classifies requirement items as fix or add", () => {
    expect(classifyRequirementItemKind("기존 애니메이션 버그 수정")).toBe(RequirementItemKind.Fix);
    expect(classifyRequirementItemKind("게시물 삭제 기능 추가")).toBe(RequirementItemKind.Add);
  });

  test("classifies calc and action tasks by dependency rules", () => {
    expect(
      classifyTaskKind({
        readsExternalSystem: false,
        writesExternalState: false,
        usesRuntimeValue: false,
        callsDomainService: false,
      }),
    ).toBe(TaskKind.Calc);

    expect(
      classifyTaskKind({
        readsExternalSystem: true,
        writesExternalState: false,
        usesRuntimeValue: false,
        callsDomainService: false,
      }),
    ).toBe(TaskKind.Action);
  });

  test("builds task drafts in input > output form", () => {
    expect(buildTaskDraft("id로 게시물을 삭제")).toBe("id > 게시물을 삭제");
  });

  test("renders job and tasks documents with required sections", () => {
    const jobDocument = renderJobDocument({
      requestName: "게시물 삭제 기능",
      requirements: [
        {
          kind: RequirementItemKind.Add,
          name: "게시물 삭제 기능",
          rules: ["id 값으로만 지워야 한다."],
        },
      ],
      logicChecklist: ["삭제 후 목록에서 사라져야 한다."],
      uiChecklist: [],
      problems: [],
    });

    const tasksDocument = renderTasksDocument({
      name: "게시물 삭제 기능",
      calc: [{ name: "id > 삭제 가능 여부 판단", status: "wait" }],
      action: [{ name: "id > 게시물 삭제", status: "wait" }],
      check: ["id가 비어 있으면 실패해야 한다."],
    });

    expect(jobDocument).toContain("#requirements");
    expect(jobDocument).toContain("### [add]게시물 삭제 기능");
    expect(jobDocument).toContain("## logic_checklist");
    expect(tasksDocument).toContain("tasks:");
    expect(tasksDocument).toContain("calc:");
    expect(tasksDocument).toContain("action:");
    expect(tasksDocument).toContain("check:");
  });
});
