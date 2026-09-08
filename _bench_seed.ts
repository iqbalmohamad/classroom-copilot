import postgres from "postgres";
import { randomUUID, randomBytes, createHash } from "node:crypto";

const url = "postgresql://postgres:postgres@127.0.0.1:5432/classroom_copilot";
const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });

const CODE = "BENCH1";

async function main() {
  await sql`delete from rooms where code = ${CODE}`;
  const roomId = randomUUID();
  await sql`insert into rooms (id, code, title, host_token_hash, status, public_mode)
            values (${roomId}, ${CODE}, 'Bench', ${createHash("sha256").update("x").digest("hex")}, 'open', 'poll')`;

  const pids: string[] = [];
  for (let i = 0; i < 40; i++) {
    const id = randomUUID();
    pids.push(id);
    await sql`insert into participants (id, room_id, display_name, token_hash, pulse, last_seen_at)
              values (${id}, ${roomId}, ${"Learner " + i}, ${createHash("sha256").update(randomBytes(32)).digest("hex")}, ${i % 3 === 0 ? "got_it" : i % 3 === 1 ? "shaky" : "lost"}, now())`;
  }

  // 8 polls, last one open, 40 responses on it
  let openPollId = "";
  for (let s = 1; s <= 8; s++) {
    const id = randomUUID();
    const status = s === 8 ? "open" : "closed";
    if (s === 8) openPollId = id;
    await sql`insert into polls (id, room_id, seq, prompt, kind, options, status, revealed, opened_at, closed_at)
              values (${id}, ${roomId}, ${s}, ${"Poll " + s}, 'yes_no',
                      ${sql.json([{ id: "yes", label: "Yes" }, { id: "no", label: "No" }])},
                      ${status}, ${s < 8}, now(), ${s < 8 ? sql`now()` : null})`;
    for (const pid of pids) {
      await sql`insert into poll_responses (room_id, poll_id, participant_id, value)
                values (${roomId}, ${id}, ${pid}, ${Math.random() > 0.5 ? "yes" : "no"})`;
    }
  }

  // 60 questions, each with a spread of votes
  for (let q = 0; q < 60; q++) {
    const qid = randomUUID();
    await sql`insert into questions (id, room_id, participant_id, body, is_anonymous, status)
              values (${qid}, ${roomId}, ${pids[q % 40]}, ${"Question number " + q + " about the topic"}, ${q % 2 === 0}, 'open')`;
    const voters = pids.slice(0, (q * 7) % 40);
    for (const v of voters) {
      await sql`insert into question_votes (room_id, question_id, participant_id)
                values (${roomId}, ${qid}, ${v})`;
    }
  }

  for (let p = 0; p < 25; p++) {
    await sql`insert into picks (id, room_id, participant_id, display_name)
              values (${randomUUID()}, ${roomId}, ${pids[p % 40]}, ${"Learner " + (p % 40)})`;
  }

  console.log(JSON.stringify({ roomId, openPollId, pids: pids.slice(0, 40) }));
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
