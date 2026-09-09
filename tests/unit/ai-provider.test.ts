import { afterEach, describe, expect, it, vi } from "vitest";
import { AiUnavailable, classRead } from "@/lib/ai";
import type { InstructorSnapshot } from "@/lib/types";

/**
 * Every failure path of the optional AI feature, because the whole point of it
 * being optional is that none of these can disturb a class.
 */
const snapshot: InstructorSnapshot = {
  role: "instructor",
  version: 1,
  room: {
    code: "ABC234",
    title: "Class",
    status: "open",
    publicMode: "join",
    currentSectionId: null,
    currentSectionTitle: null,
    createdAt: "2026-09-13T10:00:00.000Z",
    endedAt: null,
  },
  joinUrl: "https://example.test/r/ABC234",
  roster: [],
  presentCount: 3,
  joinedCount: 3,
  activePoll: null,
  polls: [],
  pulse: {
    counts: { got_it: 1, shaky: 1, lost: 1 },
    percents: { got_it: 33, shaky: 33, lost: 33 },
    responded: 3,
    noResponse: 0,
    total: 3,
  },
  questions: [],
  picks: [],
  aiEnabled: true,
  sections: [],
  pulseRound: null,
  pulseHistory: [],
  activities: [],
  materials: [],
  timer: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function withKey() {
  vi.stubEnv("AI_API_KEY", "test-key");
}

describe("class read", () => {
  it("does nothing at all when no key is configured", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(classRead(snapshot)).rejects.toBeInstanceOf(AiUnavailable);
    // Not even a request: an unconfigured deployment must not reach out.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the provider's prose on success", async () => {
    withKey();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          content: [{ type: "text", text: "  Understanding looks mixed. Try another example.  " }],
        }),
      ),
    );

    await expect(classRead(snapshot)).resolves.toBe(
      "Understanding looks mixed. Try another example.",
    );
  });

  it("sends the key server-side and never the room's private data", async () => {
    withKey();
    const fetchSpy = vi.fn(async () =>
      Response.json({ content: [{ type: "text", text: "ok" }] }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await classRead(snapshot);

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(init.body as string).not.toContain("example.test");
    expect(init.body as string).not.toContain("ABC234");
  });

  it("fails gracefully when the provider errors", async () => {
    withKey();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(classRead(snapshot)).rejects.toBeInstanceOf(AiUnavailable);
  });

  it("fails gracefully when the provider is unreachable", async () => {
    withKey();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    await expect(classRead(snapshot)).rejects.toBeInstanceOf(AiUnavailable);
  });

  it("fails gracefully when the provider returns nothing usable", async () => {
    withKey();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: [] })));
    await expect(classRead(snapshot)).rejects.toBeInstanceOf(AiUnavailable);
  });

  it("gives up rather than hanging when the provider stalls", async () => {
    withKey();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    );

    const started = Date.now();
    await expect(classRead(snapshot)).rejects.toThrow(/timed out/);
    // The class cannot wait on a provider; the cap is nine seconds.
    expect(Date.now() - started).toBeLessThan(11_000);
  }, 15_000);

  it("caps the length of whatever comes back", async () => {
    withKey();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ content: [{ type: "text", text: "x".repeat(5000) }] })),
    );
    await expect(classRead(snapshot)).resolves.toHaveLength(600);
  });
});
