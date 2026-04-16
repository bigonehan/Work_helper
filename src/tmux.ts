export interface TmuxCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const runTmux = async (args: string[]): Promise<TmuxCommandResult> => {
  const proc = Bun.spawn(["tmux", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
};

export const createDetachedSession = async (
  sessionName: string,
  command: string,
): Promise<TmuxCommandResult> => runTmux(["new-session", "-d", "-s", sessionName, command]);

export const capturePane = async (sessionName: string): Promise<string> => {
  const result = await runTmux(["capture-pane", "-p", "-t", sessionName]);
  return result.stdout;
};

export const captureTargetPane = async (target: string): Promise<string> => {
  const result = await runTmux(["capture-pane", "-p", "-t", target]);
  return result.stdout;
};

export const createWindow = async (
  sessionName: string,
  windowName: string,
  command: string,
): Promise<TmuxCommandResult> => runTmux(["new-window", "-d", "-t", sessionName, "-n", windowName, command]);

export const sessionExists = async (sessionName: string): Promise<boolean> => {
  const result = await runTmux(["has-session", "-t", sessionName]);
  return result.exitCode === 0;
};

export const targetExists = async (target: string): Promise<boolean> => {
  const result = await runTmux(["has-session", "-t", target]);
  return result.exitCode === 0;
};

export const killSession = async (sessionName: string): Promise<void> => {
  await runTmux(["kill-session", "-t", sessionName]);
};

export const killWindow = async (target: string): Promise<void> => {
  await runTmux(["kill-window", "-t", target]);
};
