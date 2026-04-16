import { Effect } from "effect";
import { runPromptInTmux } from "./runPromptInTmux";

const provider = (process.argv[2] as "codex" | "gemini" | undefined) ?? "codex";

const result = await Effect.runPromise(
  runPromptInTmux({
    provider,
    msg: "Reply with only the answer to: 1+1",
    workspaceDir: process.cwd(),
    totalTimeoutMs: 120_000,
    firstOutputTimeoutMs: 15_000,
    responseTimeoutMs: 90_000,
  }),
);

console.log(JSON.stringify(result, null, 2));
