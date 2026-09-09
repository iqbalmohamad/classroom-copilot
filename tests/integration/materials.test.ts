import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

interface WithMaterials {
  materials: {
    id: string;
    title: string;
    url: string;
    note: string | null;
    highlighted: boolean;
    sectionTitle: string | null;
  }[];
  sections: { id: string; title: string }[];
}

describe("classroom materials", () => {
  it("shares dataset, install and LMS links with the class", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const links = [
      { title: "PostgreSQL download", url: "https://www.postgresql.org/download/" },
      { title: "DBeaver download", url: "https://dbeaver.io/download/" },
      {
        title: "Assignment guidance",
        url: "https://lms.example.test/day-30",
        note: "Deadline Sunday 23.30 WIB",
        highlighted: true,
      },
    ];
    for (const link of links) {
      expect((await instructor.post(`/api/rooms/${code}/materials`, link)).status).toBe(200);
    }

    const seen = await snapshotFor<WithMaterials>(learner, code, "learner");
    // Highlighted first: on a phone, the one that matters right now is at the top.
    expect(seen.body.snapshot.materials[0]!.title).toBe("Assignment guidance");
    expect(seen.body.snapshot.materials.map((m) => m.title)).toHaveLength(3);
    expect(seen.body.snapshot.materials[0]!.note).toContain("23.30");
  });

  it("refuses a scheme that could run something in a learner's browser", async () => {
    const { instructor, code } = await createRoom();

    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      const attempt = await instructor.post(`/api/rooms/${code}/materials`, {
        title: "Bad",
        url,
      });
      expect(attempt.status, `${url} should be refused`).toBe(400);
    }

    const state = await snapshotFor<WithMaterials>(instructor, code, "instructor");
    expect(state.body.snapshot.materials).toHaveLength(0);
  });

  it("assumes https for a bare host rather than rejecting what people paste", async () => {
    const { instructor, code } = await createRoom();
    await instructor.post(`/api/rooms/${code}/materials`, {
      title: "Guide",
      url: "dbeaver.io/download/",
    });
    const state = await snapshotFor<WithMaterials>(instructor, code, "instructor");
    expect(state.body.snapshot.materials[0]!.url).toBe("https://dbeaver.io/download/");
  });

  it("attaches a link to a section, and keeps earlier ones findable", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await instructor.post(`/api/rooms/${code}/sections`, { title: "Environment Setup" });
    const sections = (await snapshotFor<WithMaterials>(instructor, code, "instructor")).body
      .snapshot.sections;

    await instructor.post(`/api/rooms/${code}/materials`, {
      title: "Install guide",
      url: "https://example.test/install",
      sectionId: sections[1]!.id,
    });
    await instructor.post(`/api/rooms/${code}/materials`, {
      title: "Whole-session link",
      url: "https://example.test/all",
    });

    // Move on; the earlier section's material is still listed.
    await instructor.post(`/api/rooms/${code}/sections/select`, { sectionId: sections[1]!.id });
    await instructor.post(`/api/rooms/${code}/sections/select`, {});

    const seen = await snapshotFor<WithMaterials>(learner, code, "learner");
    const install = seen.body.snapshot.materials.find((m) => m.title === "Install guide")!;
    expect(install.sectionTitle).toBe("Environment Setup");
    expect(seen.body.snapshot.materials).toHaveLength(2);
  });

  it("edits and removes, and only for the instructor", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/materials`, {
      title: "Draft",
      url: "https://example.test/one",
    });

    expect(
      (await learner.patch(`/api/rooms/${code}/materials/${created.body.id}`, { title: "Mine" }))
        .status,
    ).toBe(403);
    expect(
      (await learner.delete(`/api/rooms/${code}/materials/${created.body.id}`)).status,
    ).toBe(403);

    await instructor.patch(`/api/rooms/${code}/materials/${created.body.id}`, {
      title: "Hands-on guide",
      highlighted: true,
    });
    let state = await snapshotFor<WithMaterials>(instructor, code, "instructor");
    expect(state.body.snapshot.materials[0]!.title).toBe("Hands-on guide");
    expect(state.body.snapshot.materials[0]!.highlighted).toBe(true);

    await instructor.delete(`/api/rooms/${code}/materials/${created.body.id}`);
    state = await snapshotFor<WithMaterials>(instructor, code, "instructor");
    expect(state.body.snapshot.materials).toHaveLength(0);
  });

  it("keeps the projector free of the materials list", async () => {
    const { instructor, code } = await createRoom();
    await instructor.post(`/api/rooms/${code}/materials`, {
      title: "Internal marking rubric",
      url: "https://example.test/rubric",
    });
    const screen = await snapshotFor(new Client("screen"), code, "public");
    expect(JSON.stringify(screen.body.snapshot)).not.toContain("rubric");
  });
});
