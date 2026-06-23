import { describe, expect, test } from "bun:test";
import { badRequest, notFound } from "../src/server/http";

describe("server http helpers", () => {
  test("formats error responses with stable status codes", async () => {
    const badRequestResponse = badRequest(new Error("Invalid input."));
    expect(badRequestResponse.status).toBe(400);
    await expect(badRequestResponse.json()).resolves.toEqual({ error: "Invalid input." });

    const notFoundResponse = notFound("Project not found.");
    expect(notFoundResponse.status).toBe(404);
    await expect(notFoundResponse.json()).resolves.toEqual({ error: "Project not found." });
  });
});
