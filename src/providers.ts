import { realpathSync } from "node:fs";
import { relative } from "node:path";
import type { CodexApprovalPolicy, CodexSandboxMode, Provider } from "./types";

export interface ProviderCommand {
  readonly provider: Provider;
  readonly argv: readonly string[];
  readonly commandPreview: string;
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const defaultCodexSandbox: CodexSandboxMode = "inherit";
const defaultCodexApprovalPolicy: CodexApprovalPolicy = "never";

const codexSandboxModes = new Set<CodexSandboxMode>(["inherit", "read-only", "workspace-write"]);
const codexApprovalPolicies = new Set<CodexApprovalPolicy>(["never"]);

const getCodexSandbox = (): CodexSandboxMode => {
  const configured = process.env.WORK_HELPER_CODEX_SANDBOX;
  if (!configured) {
    return defaultCodexSandbox;
  }

  if (!codexSandboxModes.has(configured as CodexSandboxMode)) {
    throw new Error(`Unsupported WORK_HELPER_CODEX_SANDBOX: ${configured}`);
  }

  return configured as CodexSandboxMode;
};

const getCodexApprovalPolicy = (): CodexApprovalPolicy => {
  const configured = process.env.WORK_HELPER_CODEX_APPROVAL_POLICY;
  if (!configured) {
    return defaultCodexApprovalPolicy;
  }

  if (!codexApprovalPolicies.has(configured as CodexApprovalPolicy)) {
    throw new Error(`Unsupported WORK_HELPER_CODEX_APPROVAL_POLICY: ${configured}`);
  }

  return configured as CodexApprovalPolicy;
};

const assertWorkspaceWithinCodexoRoot = (workspaceDir: string): void => {
  const root = process.env.CODEXO_WORKSPACE_ROOT;
  if (!root) {
    return;
  }

  const realRoot = realpathSync(root);
  const realWorkspace = realpathSync(workspaceDir);
  const pathFromRoot = relative(realRoot, realWorkspace);
  if (pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !pathFromRoot.startsWith("/"))) {
    return;
  }

  throw new Error(`Workspace is outside CODEXO_WORKSPACE_ROOT: ${workspaceDir}`);
};

export const buildProviderCommand = (
  provider: Provider,
  msg: string,
  workspaceDir: string,
  marker: string,
): ProviderCommand => {
  const safeWorkspaceDir = shellQuote(workspaceDir);
  const safeMsg = shellQuote(msg);
  const safeMarker = shellQuote(marker);

  if (provider === "codex") {
    assertWorkspaceWithinCodexoRoot(workspaceDir);
    const sandbox = getCodexSandbox();
    const approvalPolicy = getCodexApprovalPolicy();
    const sandboxArg = sandbox === "inherit" ? "" : ` --sandbox ${sandbox}`;
    const inner =
      `cd ${safeWorkspaceDir} && ` +
      `codex --ask-for-approval ${approvalPolicy} exec --cd ${safeWorkspaceDir}${sandboxArg} --color never ${safeMsg}; ` +
      `status=$?; printf '\\n${marker}:%s\\n' "$status"; sleep 2`;

    return {
      provider,
      argv: ["bash", "-lc", inner],
      commandPreview:
        `codex --ask-for-approval ${approvalPolicy} exec --cd <workspace>${sandboxArg ? " --sandbox <mode>" : ""} --color never <msg>`,
    };
  }

  const inner =
    `cd ${safeWorkspaceDir} && ` +
    `gemini -p ${safeMsg} --approval-mode yolo --sandbox false -o text; ` +
    `status=$?; printf '\\n${marker}:%s\\n' "$status"; sleep 2`;

  return {
    provider,
    argv: ["bash", "-lc", inner],
    commandPreview: "gemini -p <msg> --approval-mode yolo --sandbox false -o text",
  };
};

export const classifyAuthHints = (pane: string): string[] => {
  const hints: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/Loaded cached credentials/i, "cached_credentials_loaded"],
    [/Keychain initialization encountered an error/i, "keychain_fallback"],
    [/login/i, "login_related_output"],
    [/auth/i, "auth_related_output"],
    [/credential/i, "credential_related_output"],
  ];

  for (const [pattern, hint] of patterns) {
    if (pattern.test(pane)) {
      hints.push(hint);
    }
  }

  return hints;
};
