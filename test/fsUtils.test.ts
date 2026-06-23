import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNodeErrorCode, pathExists, readOptionalTextFile } from "../src/fsUtils";

describe("filesystem helpers", () => {
  test("recognizes node error codes", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(isNodeErrorCode(error, "ENOENT")).toBe(true);
    expect(isNodeErrorCode(error, "EACCES")).toBe(false);
    expect(isNodeErrorCode("missing", "ENOENT")).toBe(false);
  });

  test("returns null or false for missing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "work-helper-fs-"));
    const missing = join(root, "missing.txt");

    await expect(readOptionalTextFile(missing)).resolves.toBeNull();
    await expect(pathExists(missing)).resolves.toBe(false);
  });

  test("reads existing text files and detects existing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "work-helper-fs-"));
    const filePath = join(root, "present.txt");
    await writeFile(filePath, "hello\n", "utf8");

    await expect(readOptionalTextFile(filePath)).resolves.toBe("hello\n");
    await expect(pathExists(filePath)).resolves.toBe(true);
    await expect(readFile(filePath, "utf8")).resolves.toBe("hello\n");
  });
});
