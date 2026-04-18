import type { Provider } from "./types";

export interface ProviderCommand {
  readonly provider: Provider;
  readonly argv: readonly string[];
  readonly commandPreview: string;
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

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
    const inner =
      `cd ${safeWorkspaceDir} && ` +
      `codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --color never ${safeMsg}; ` +
      `status=$?; printf '\\n${marker}:%s\\n' "$status"; sleep 2`;

    return {
      provider,
      argv: ["bash", "-lc", inner],
      commandPreview:
        "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --color never <msg>",
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
