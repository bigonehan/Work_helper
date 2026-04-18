export enum RequirementItemKind {
  Fix = "fix",
  Add = "add",
}

export enum TaskKind {
  Calc = "calc",
  Action = "action",
}

export interface RequirementDocumentItem {
  readonly kind: RequirementItemKind;
  readonly name: string;
  readonly steps?: readonly string[];
  readonly rules?: readonly string[];
}

export interface TaskItem {
  readonly name: string;
  readonly status: "wait" | "work" | "verify" | "complete" | "fail";
}

export interface TaskClassificationInput {
  readonly readsExternalSystem: boolean;
  readonly writesExternalState: boolean;
  readonly usesRuntimeValue: boolean;
  readonly callsDomainService: boolean;
}

export interface RenderJobDocumentInput {
  readonly requestName: string;
  readonly requirements: readonly RequirementDocumentItem[];
  readonly logicChecklist: readonly string[];
  readonly uiChecklist: readonly string[];
  readonly problems: readonly string[];
}

export interface RenderTasksDocumentInput {
  readonly name: string;
  readonly calc: readonly TaskItem[];
  readonly action: readonly TaskItem[];
  readonly check: readonly string[];
}

const fixPattern = /(개선|수정|버그|레거시\s*제거)/u;

export const classifyRequirementItemKind = (request: string): RequirementItemKind =>
  fixPattern.test(request) ? RequirementItemKind.Fix : RequirementItemKind.Add;

export const classifyTaskKind = (input: TaskClassificationInput): TaskKind =>
  input.readsExternalSystem || input.writesExternalState || input.usesRuntimeValue || input.callsDomainService
    ? TaskKind.Action
    : TaskKind.Calc;

export const buildTaskDraft = (description: string): string => {
  const trimmed = description.trim();
  if (!trimmed) {
    return "input > output";
  }

  if (trimmed.includes(">")) {
    return trimmed;
  }

  const subjectMatch = trimmed.match(/^([A-Za-z0-9_]+)(?:로|으로|를|을)?\s*(.*)$/u);
  if (!subjectMatch) {
    return `input > ${trimmed}`;
  }

  const [, input, remainder] = subjectMatch;
  return `${input} > ${remainder.trim() || trimmed}`;
};

export const renderJobDocument = (input: RenderJobDocumentInput): string => {
  const requirementSections = input.requirements
    .map((item) => {
      const lines = [`### [${item.kind}]${item.name}`];
      if (item.steps?.length) {
        lines.push("#### step", ...item.steps.map((step, index) => `${index + 1}. ${step}`));
      }
      if (item.rules?.length) {
        lines.push("#### rules", ...item.rules.map((rule) => `- ${rule}`));
      }
      return lines.join("\n");
    })
    .join("\n");

  return [
    "# requirement",
    `## ${input.requestName}`,
    "#requirements",
    "##wait",
    requirementSections,
    "## work",
    "## verify",
    "## complete",
    "## fail",
    "# problems",
    ...input.problems.map((problem) => `- [ ] ${problem}`),
    "# check",
    "## logic_checklist",
    ...input.logicChecklist.map((item) => `- ${item}`),
    "## ui_checklist",
    ...input.uiChecklist.map((item) => `- ${item}`),
  ].join("\n");
};

export const renderTasksDocument = (input: RenderTasksDocumentInput): string => {
  const renderTaskSection = (label: string, items: readonly TaskItem[]) => [
    `  ${label}:`,
    ...items.flatMap((item) => [`    - name: ${item.name}`, `      status: ${item.status}`]),
  ];

  return [
    `name: ${input.name}`,
    "tasks:",
    ...renderTaskSection("calc", input.calc),
    ...renderTaskSection("action", input.action),
    "check:",
    ...input.check.map((item) => `  - ${item}`),
  ].join("\n");
};
