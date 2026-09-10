import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createRoom, joinAs } from "./client";
import { findRoom } from "@/lib/auth";
import { setPulse } from "@/lib/service";

/**
 * The end-of-class race, driven at the service layer on purpose.
 *
 * Over HTTP the window cannot be held open: a route loads the room, the
 * instructor's End Class commits, and only then does the learner's write run
 * its transaction — with a room row that still says "open". Every other guard
 * happens to miss exactly one path: a quick-start pulse tap names no round
 * (nothing was open on its screen) and the pulse epoch does not change at the
 * end of class, so only the in-transaction status re-read in setPulse stands
 * between that tap and a brand-new open round in an ended room.
 *
 * This file talks to the same _test database the integration server uses, so
 * the process-wide pool in lib/db must be pointed there before the first query
 * — hence the env override below, which runs before any lazy pool creation.
 */
process.env.DATABASE_URL = process.env.CC_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("the end-of-class race", () => {
  it("refuses a quick-start pulse tap that was in flight when the class ended", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");

    // The room row the learner's request had already loaded while the class
    // was open — the stale view the route boundary's assertRoomOpen checked.
    const stale = await findRoom(code);
    expect(stale?.status).toBe("open");

    expect((await instructor.post(`/api/rooms/${code}/end`)).status).toBe(200);

    const db = postgres(process.env.CC_TEST_DATABASE_URL ?? process.env.DATABASE_URL!, {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    try {
      const [participant] = await db<{ id: string }[]>`
        select id from participants where room_id = ${stale!.id}`;

      await expect(
        setPulse(
          stale!,
          participant!.id,
          "got_it",
          null,
          stale!.current_section_id,
          stale!.pulse_epoch,
        ),
      ).rejects.toThrowError(/has ended/);

      // And the room gained nothing that looks live.
      const open = await db`
        select id from pulse_rounds where room_id = ${stale!.id} and status = 'open'`;
      expect(open.length).toBe(0);
      const responses = await db<{ n: string }[]>`
        select count(*)::text as n from pulse_responses where room_id = ${stale!.id}`;
      expect(Number(responses[0]!.n)).toBe(0);
    } finally {
      await db.end({ timeout: 5 });
    }
  });

  afterAll(async () => {
    // The lazy process pool lib/db created for the direct service calls.
    await globalThis.__ccSql?.end({ timeout: 5 })?.catch(() => {});
  });
});
