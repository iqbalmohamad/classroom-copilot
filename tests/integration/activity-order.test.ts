import { describe, expect, it } from "vitest";
import { BASE_URL, Client, createRoom, joinAs, snapshotFor } from "./client";

interface Host {
  activities: {
    id: string;
    seq: number;
    title: string;
    sectionId: string | null;
    instructions: string | null;
    referenceAnswer?: string | null;
    durationSeconds: number | null;
    fields: { type: string; label: string }[];
  }[];
  sections: { id: string; title: string }[];
}

const host = async (client: Client, code: string) =>
  (await snapshotFor<Host>(client, code, "instructor")).body.snapshot;

async function threeActivities() {
  const { instructor, code } = await createRoom();
  for (const title of ["First", "Second", "Third"]) {
    await instructor.post(`/api/rooms/${code}/activities`, { title });
  }
  return { instructor, code };
}

describe("activity order", () => {
  it("keeps prepared activities in the order they were created", async () => {
    const { instructor, code } = await threeActivities();
    expect((await host(instructor, code)).activities.map((a) => a.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("reorders them, and the order persists", async () => {
    const { instructor, code } = await threeActivities();
    const ids = (await host(instructor, code)).activities.map((a) => a.id);

    const moved = await instructor.post(`/api/rooms/${code}/activities/reorder`, {
      order: [ids[2]!, ids[0]!, ids[1]!],
    });
    expect(moved.status).toBe(200);

    const after = await host(instructor, code);
    expect(after.activities.map((a) => a.title)).toEqual(["Third", "First", "Second"]);
    expect(after.activities.map((a) => a.seq)).toEqual([1, 2, 3]);
  });

  it("refuses a partial or foreign order rather than half-applying it", async () => {
    const { instructor, code } = await threeActivities();
    const ids = (await host(instructor, code)).activities.map((a) => a.id);

    for (const order of [
      [ids[0]!, ids[1]!],
      [ids[0]!, ids[0]!, ids[1]!],
      [ids[0]!, ids[1]!, "11111111-1111-1111-1111-111111111111"],
    ]) {
      expect((await instructor.post(`/api/rooms/${code}/activities/reorder`, { order })).status).toBe(
        409,
      );
    }
    expect((await host(instructor, code)).activities.map((a) => a.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("survives two instructors reordering at the same moment", async () => {
    const { instructor, code } = await threeActivities();
    const ids = (await host(instructor, code)).activities.map((a) => a.id);

    const results = await Promise.all([
      instructor.post(`/api/rooms/${code}/activities/reorder`, {
        order: [ids[2]!, ids[1]!, ids[0]!],
      }),
      instructor.post(`/api/rooms/${code}/activities/reorder`, {
        order: [ids[1]!, ids[0]!, ids[2]!],
      }),
    ]);
    // Both are complete permutations, so both are legal; whichever commits last
    // wins, and the result is one of the two, never a mixture.
    expect(results.every((r) => r.status === 200)).toBe(true);

    const titles = (await host(instructor, code)).activities.map((a) => a.title);
    expect([
      ["Third", "Second", "First"].join(),
      ["Second", "First", "Third"].join(),
    ]).toContain(titles.join());
  });

  it("attaches activities to sections so the console can group them", async () => {
    const { instructor, code } = await createRoom();
    await instructor.post(`/api/rooms/${code}/sections`, { title: "Environment Setup" });
    const sections = (await host(instructor, code)).sections;

    await instructor.post(`/api/rooms/${code}/activities`, {
      title: "Prove your connection",
      sectionId: sections[1]!.id,
    });
    await instructor.post(`/api/rooms/${code}/activities`, { title: "Loose" });

    const state = await host(instructor, code);
    expect(state.activities.find((a) => a.title === "Prove your connection")!.sectionId).toBe(
      sections[1]!.id,
    );
    expect(state.activities.find((a) => a.title === "Loose")!.sectionId).toBe(sections[0]!.id);
  });

  it("carries the order into a saved plan and back out again", async () => {
    const { instructor, code } = await threeActivities();
    const ids = (await host(instructor, code)).activities.map((a) => a.id);
    await instructor.post(`/api/rooms/${code}/activities/reorder`, {
      order: [ids[2]!, ids[0]!, ids[1]!],
    });

    const plan = await instructor.post<{ id: string; token: string }>(
      `/api/rooms/${code}/plan`,
      {},
    );
    const next = new Client("next-term");
    const created = await next.post<{ code: string }>("/api/rooms", {
      planId: plan.body.id,
      planToken: plan.body.token,
    });

    // A deck reordered this term comes back reordered next term.
    expect((await host(next, created.body.code)).activities.map((a) => a.title)).toEqual([
      "Third",
      "First",
      "Second",
    ]);
  });
});

describe("editing a prepared activity", () => {
  it("edits every preparation field", async () => {
    const { instructor, code } = await createRoom();
    await instructor.post(`/api/rooms/${code}/sections`, { title: "DDL Practice" });
    const sections = (await host(instructor, code)).sections;

    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Rough draft",
    });

    const edited = await instructor.patch(`/api/rooms/${code}/activities/${created.body.id}`, {
      title: "Build the first two tables",
      instructions: "categories, then customers.",
      sectionId: sections[1]!.id,
      referenceAnswer: "CREATE TABLE categories (...);",
      durationSeconds: 480,
      fields: [
        { label: "Your CREATE TABLE", type: "sql" },
        { label: "Rows affected", type: "number" },
      ],
    });
    expect(edited.status).toBe(200);

    const activity = (await host(instructor, code)).activities[0]!;
    expect(activity.title).toBe("Build the first two tables");
    expect(activity.instructions).toContain("categories");
    expect(activity.sectionId).toBe(sections[1]!.id);
    expect(activity.referenceAnswer).toContain("CREATE TABLE");
    expect(activity.durationSeconds).toBe(480);
    expect(activity.fields.map((f) => f.type)).toEqual(["sql", "number"]);
  });

  it("still edits the rest once answered, but not the questions", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Answered already",
      openNow: true,
    });
    await learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
      answers: { f1: "mine" },
    });

    const safe = await instructor.patch(`/api/rooms/${code}/activities/${created.body.id}`, {
      referenceAnswer: "order_items",
      durationSeconds: 300,
    });
    expect(safe.status).toBe(200);

    const risky = await instructor.patch(`/api/rooms/${code}/activities/${created.body.id}`, {
      fields: [{ label: "Something else", type: "short_text" }],
    });
    expect(risky.status).toBe(409);

    const activity = (await host(instructor, code)).activities[0]!;
    expect(activity.referenceAnswer).toBe("order_items");
    expect(activity.durationSeconds).toBe(300);
  });
});

describe("reopening an earlier session", () => {
  it("signs the instructor back in from a saved key, at the answers", async () => {
    const { instructor, code, hostToken } = await createRoom("Day 30");
    const { learner } = await joinAs(code, "Ada");
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Write one business question",
      openNow: true,
    });
    await learner.post(`/api/rooms/${code}/activities/${activity.body.id}/respond`, {
      answers: { f1: "Which city buys the most?" },
    });

    // A week later, a different browser: the cookie is long gone.
    const later = new Client("day-31-laptop");
    expect((await later.get(`/api/rooms/${code}/summary`)).status).toBe(403);

    const claimed = await later.get(`/api/rooms/${code}/claim?t=${hostToken}&to=summary`);
    expect(claimed.status).toBe(307);
    expect(String((claimed.body as { raw?: string }).raw ?? "")).not.toContain(hostToken);

    const summary = await later.get<{
      summary: { activities: { responses: { displayName: string; answers: Record<string, string> }[] }[] };
    }>(`/api/rooms/${code}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.summary.activities[0]!.responses[0]!.displayName).toBe("Ada");
    expect(summary.body.summary.activities[0]!.responses[0]!.answers.f1).toContain("city");
  });

  it("redirects to the public origin, so the cookie it just set is not stranded", async () => {
    const { code, hostToken } = await createRoom();
    const client = new Client("laptop");
    const claimed = await client.request(`/api/rooms/${code}/claim?t=${hostToken}`);
    expect(claimed.status).toBe(307);

    // Next reports a route handler's own request.url as the server's internal
    // address. Redirecting to that moves the browser to a different origin and
    // leaves the cookie behind, which is how a perfectly valid instructor link
    // used to land on "Instructor access needed".
    const location = claimed.headers?.location ?? "";
    expect(location).toContain(BASE_URL);
    expect(client.setCookies.join(" ")).toContain(`cc_host_${code}=`);
  });

  it("will not land anywhere the caller chooses", async () => {
    const { code, hostToken } = await createRoom();
    const client = new Client("redirect-probe");
    const claimed = await client.get(
      `/api/rooms/${code}/claim?t=${hostToken}&to=https://evil.test/`,
    );
    expect(claimed.status).toBe(307);
    // Anything but the two known destinations falls back to the console.
    expect((await client.get(`/api/rooms/${code}/state?role=instructor`)).status).toBe(200);
  });

  it("still refuses a room code with no key", async () => {
    const { code } = await createRoom();
    const stranger = new Client("stranger");
    expect((await stranger.get(`/api/rooms/${code}/claim?t=guess`)).status).toBe(307);
    expect((await stranger.get(`/api/rooms/${code}/summary`)).status).toBe(403);
  });
});
