import { describe, expect, it } from "vitest";
import { Client, createRoom } from "./client";

/**
 * The classroom must work with AI switched off, which is how the test
 * deployment runs. These tests pin that: the feature is refused cleanly rather
 * than erroring, and it is instructor-only either way.
 */
describe("AI class read (optional feature)", () => {
  it("is reported as disabled when no provider key is configured", async () => {
    const { instructor, code } = await createRoom();
    const state = await instructor.request<{ snapshot: { aiEnabled: boolean } }>(
      `/api/rooms/${code}/state?role=instructor`,
    );
    expect(state.body.snapshot.aiEnabled).toBe(false);
  });

  it("refuses politely instead of failing when it is not enabled", async () => {
    const { instructor, code } = await createRoom();
    const result = await instructor.post(`/api/rooms/${code}/ai-read`);
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).toContain("not enabled");
  });

  it("is instructor-only", async () => {
    const { code } = await createRoom();
    const stranger = new Client("stranger");
    expect((await stranger.post(`/api/rooms/${code}/ai-read`)).status).toBe(403);
  });
});
