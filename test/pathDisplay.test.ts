import { describe, expect, test } from "bun:test";
import { formatCompactProjectPath } from "../src/pathDisplay";

describe("path display", () => {
  test("shows the final two segments and truncates long project names", () => {
    expect(formatCompactProjectPath("/home/tree/project/write_new/.write-new/projects/crud-검")).toBe(
      "/projects/crud...",
    );
  });

  test("keeps only the final two relative path segments", () => {
    expect(formatCompactProjectPath("a/b/c/d/app")).toBe("d/app");
  });

  test("keeps short project names unchanged", () => {
    expect(formatCompactProjectPath("/a/b/app")).toBe("/b/app");
  });

  test("normalizes trailing and windows separators", () => {
    expect(formatCompactProjectPath("C:\\work\\demo-project\\todo-list\\")).toBe("demo-project/todo...");
  });
});
