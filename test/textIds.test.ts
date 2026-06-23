import { describe, expect, test } from "bun:test";
import { toKebabId } from "../src/textIds";

describe("text id helpers", () => {
  test("builds bounded ascii kebab identifiers with fallback", () => {
    expect(toKebabId("Project Demo 01")).toBe("project-demo-01");
    expect(toKebabId("  already---spaced  ")).toBe("already-spaced");
    expect(toKebabId("한글")).toBe("default");
    expect(toKebabId("a".repeat(45))).toBe("a".repeat(40));
  });

  test("allows custom fallback and max length", () => {
    expect(toKebabId("한글", { fallback: "project", maxLength: 12 })).toBe("project");
    expect(toKebabId("Long Project Name", { maxLength: 9 })).toBe("long-proj");
  });
});
