import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  destroyProjectTmuxSession,
  ensureProjectTmuxSession,
  getProjectTaskSnapshot,
  submitProjectTaskToTmux,
  waitForProjectTask,
} from "../src/projectManager";
import { createContainsAnyValidator } from "../src/validators";

const runWithRetries = async <T>(attempts: number, fn: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

describe("projectManager", () => {
  test("submits a Seoul tourism task and completes with recognizable locations", async () => {
    await runWithRetries(3, async () => {
      const projectId = `seoul-demo-${Date.now().toString(36)}`;

      try {
        await Effect.runPromise(ensureProjectTmuxSession(projectId, process.cwd()));

        const handle = await Effect.runPromise(
          submitProjectTaskToTmux({
            projectId,
            taskId: "seoul-tourism",
            provider: "codex",
            prompt: "서울 관광명소를 추천해줘",
            workspaceDir: process.cwd(),
            answerValidator: createContainsAnyValidator([
              "경복궁",
              "남산서울타워",
              "북촌한옥마을",
              "명동",
              "홍대",
              "광화문",
              "인사동",
            ]),
          }),
        );

        const snapshot = await Effect.runPromise(getProjectTaskSnapshot(projectId, handle.taskId));
        expect(snapshot).not.toBeNull();
        expect(snapshot?.sessionName).toContain("project-seoul-demo");

        const finalSnapshot = await Effect.runPromise(waitForProjectTask(projectId, handle.taskId));
        expect(finalSnapshot.status).toBe("completed");
        expect(finalSnapshot.answerPreview).toBeString();
        expect(
          ["경복궁", "남산서울타워", "북촌한옥마을", "명동", "홍대", "광화문", "인사동"].some((keyword) =>
            finalSnapshot.answerPreview?.includes(keyword),
          ),
        ).toBe(true);
      } finally {
        await Effect.runPromise(destroyProjectTmuxSession(projectId));
      }
    });
  }, 130_000);
});
