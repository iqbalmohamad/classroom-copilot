/**
 * A minimal browser stand-in: one cookie jar per client, exactly like one tab.
 *
 * Tests build several of these to model a real classroom — one instructor, a
 * few learners, a projector — so that identity, authorisation and refresh
 * behaviour are exercised the way they are in the room, not mocked away.
 */
const PORT = Number(process.env.CC_TEST_PORT ?? 3311);
export const BASE_URL = process.env.CC_TEST_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export interface Result<T> {
  status: number;
  body: T;
  /** A few response headers tests need to assert on (redirect targets). */
  headers?: Record<string, string>;
}

export class Client {
  private cookies = new Map<string, string>();

  /** Raw Set-Cookie values from the most recent response, for attribute checks. */
  setCookies: string[] = [];

  constructor(readonly label: string) {}

  /** Simulates a browser that has lost its cookies but kept a token copy. */
  headerToken: { name: string; value: string } | null = null;

  async request<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Result<T>> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (this.headerToken) headers[this.headerToken.name] = this.headerToken.value;
    Object.assign(headers, options.headers ?? {});

    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "manual",
    });

    this.setCookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of this.setCookies) {
      const [pair] = raw.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (!pair || index < 0) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }

    const text = await response.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    return {
      status: response.status,
      body: body as T,
      headers: { location: response.headers.get("location") ?? "" },
    };
  }

  get<T = unknown>(path: string) {
    return this.request<T>(path);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PATCH", body });
  }

  delete<T = unknown>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  /** Throws away this client's cookies, like a fresh private tab. */
  clearCookies() {
    this.cookies.clear();
  }

  /** This client's cookies, for transports that cannot go through request(). */
  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface Snapshot {
  role: string;
  version: number;
  room: { code: string; title: string; status: string; publicMode: string };
  [key: string]: unknown;
}

export async function createRoom(title = "Test class") {
  const instructor = new Client("instructor");
  const created = await instructor.post<{ code: string; hostToken: string }>("/api/rooms", {
    title,
  });
  if (created.status !== 200) {
    throw new Error(`Could not create room: ${JSON.stringify(created.body)}`);
  }
  return { instructor, code: created.body.code, hostToken: created.body.hostToken };
}

export async function joinAs(code: string, displayName: string) {
  const learner = new Client(displayName);
  const joined = await learner.post<{ displayName: string; learnerToken: string }>(
    `/api/rooms/${code}/join`,
    { displayName },
  );
  if (joined.status !== 200) {
    throw new Error(`Could not join as ${displayName}: ${JSON.stringify(joined.body)}`);
  }
  return { learner, displayName: joined.body.displayName, token: joined.body.learnerToken };
}

export async function snapshotFor<T = Snapshot>(client: Client, code: string, role: string) {
  const result = await client.request<{ snapshot: T }>(
    `/api/rooms/${code}/state?role=${role}`,
  );
  return result;
}
