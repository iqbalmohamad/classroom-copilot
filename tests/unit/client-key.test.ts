import { describe, expect, it } from "vitest";
import { clientKey } from "@/lib/route-context";

function request(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/rooms", { headers });
}

/**
 * The rate-limit bucket key. If a caller can choose their own key, every limit
 * in the app is decorative.
 */
describe("rate-limit key", () => {
  it("prefers the platform's own header over anything the client sent", () => {
    const key = clientKey(
      request({
        "x-vercel-forwarded-for": "203.0.113.9",
        "x-forwarded-for": "1.1.1.1, 203.0.113.9",
      }),
      "join",
    );
    expect(key).toBe("join:203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKey(request({ "x-real-ip": "198.51.100.4" }), "join")).toBe("join:198.51.100.4");
  });

  it("takes the closest hop from x-forwarded-for, not the one the client chose", () => {
    // A proxy appends the real peer, so the rightmost entry is the trustworthy
    // one. Reading the leftmost would let a caller rotate through fake
    // addresses and get a fresh bucket on every request.
    const key = clientKey(request({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }), "question");
    expect(key).toBe("question:203.0.113.9");
  });

  it("cannot be split into fresh buckets by spoofing the leftmost entry", () => {
    const real = "203.0.113.9";
    const keys = new Set(
      ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((spoofed) =>
        clientKey(request({ "x-forwarded-for": `${spoofed}, ${real}` }), "question"),
      ),
    );
    expect(keys.size).toBe(1);
  });

  it("still produces a key when no address header is present", () => {
    expect(clientKey(request({}), "join")).toBe("join:local");
  });

  it("keeps scopes apart", () => {
    const headers = { "x-real-ip": "203.0.113.9" };
    expect(clientKey(request(headers), "join")).not.toBe(clientKey(request(headers), "question"));
  });
});
