"use client";

/**
 * Browser-side copy of the learner's room token.
 *
 * The authoritative copy is an httpOnly cookie. This mirror exists because a
 * phone in a real classroom can lose cookies mid-session (private tabs, storage
 * pressure, an over-eager "clear browsing data"), and a learner who has to
 * re-type their name halfway through a lesson is a reliability failure, not an
 * inconvenience. When the cookie is gone the client presents this copy in a
 * header instead and the server accepts either.
 */

const LEARNER = (code: string) => `cc.learner.${code}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage disabled — cookies still carry the session
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* non-fatal */
  }
}

function drop(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

export const learnerToken = {
  get: (code: string) => read(LEARNER(code)),
  set: (code: string, token: string) => write(LEARNER(code), token),
  clear: (code: string) => drop(LEARNER(code)),
};

/** Remembers the last name a learner used, so re-joining is one tap. */
export const rememberedName = {
  get: () => read("cc.name"),
  set: (name: string) => write("cc.name", name),
};

/**
 * Only the learner token is mirrored here.
 *
 * The instructor credential is deliberately NOT persisted in the browser: a
 * console is often opened on a shared classroom machine, and a copy in
 * localStorage would outlive the lesson, be readable by any script on the
 * origin, and could not be revoked. The instructor's recovery path is the
 * "instructor link" in the console, which they choose to save.
 */
export function authHeaders(code: string, role: "instructor" | "learner" | "public") {
  const headers: Record<string, string> = {};
  if (role === "learner") {
    const token = learnerToken.get(code);
    if (token) headers["x-cc-learner-token"] = token;
  }
  return headers;
}

/**
 * Saved session plans, kept in the instructor's own browser.
 *
 * The plan token is a credential: whoever holds it can read the plan and start
 * a class from it. It is stored here for the same reason the learner token is —
 * there are no accounts to hang it on — and it is deliberately never shown in a
 * URL, so it cannot end up in history, a referrer or a proxy log.
 */
const PLANS = "cc.plans";

export interface StoredPlan {
  id: string;
  token: string;
  title: string;
}

export const planKeys = {
  list(): StoredPlan[] {
    const raw = read(PLANS);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is StoredPlan =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as StoredPlan).id === "string" &&
          typeof (entry as StoredPlan).token === "string" &&
          typeof (entry as StoredPlan).title === "string",
      );
    } catch {
      return [];
    }
  },

  remember(id: string, token: string, title: string): void {
    const next = [{ id, token, title }, ...planKeys.list().filter((plan) => plan.id !== id)];
    write(PLANS, JSON.stringify(next.slice(0, 20)));
  },

  find(id: string): StoredPlan | null {
    return planKeys.list().find((plan) => plan.id === id) ?? null;
  },
};

/**
 * Classes this instructor chose to keep on this device.
 *
 * Opt-in, and off by default. The host token is otherwise deliberately not
 * stored in the browser: a console is often opened on a shared classroom
 * machine, and a copy there would outlive the lesson. Keeping a class is
 * therefore an explicit act with the same warning the instructor link carries —
 * and it is what makes "open Day 30's answers while teaching Day 31" possible
 * a week later, once the session cookie has long expired.
 *
 * Without it nothing changes: the instructor link is still the recovery path.
 */
const CLASSES = "cc.classes";

export interface SavedClass {
  code: string;
  title: string;
  token: string;
  savedAt: string;
}

function readClasses(): SavedClass[] {
  const raw = read(CLASSES);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedClass =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as SavedClass).code === "string" &&
        typeof (entry as SavedClass).token === "string" &&
        typeof (entry as SavedClass).title === "string",
    );
  } catch {
    return [];
  }
}

export const savedClasses = {
  list: readClasses,

  has(code: string): boolean {
    return readClasses().some((entry) => entry.code === code);
  },

  keep(entry: Omit<SavedClass, "savedAt">): void {
    const next = [
      { ...entry, savedAt: new Date().toISOString() },
      ...readClasses().filter((saved) => saved.code !== entry.code),
    ];
    write(CLASSES, JSON.stringify(next.slice(0, 40)));
  },

  forget(code: string): void {
    write(CLASSES, JSON.stringify(readClasses().filter((entry) => entry.code !== code)));
  },

  /**
   * The link that re-establishes instructor access.
   *
   * The same claim endpoint the instructor link uses: the token is verified
   * server-side and moved into an httpOnly cookie, then the browser is
   * redirected, so it never lingers in the address bar or in history.
   */
  link(entry: SavedClass, to: "console" | "summary" = "console"): string {
    return `/api/rooms/${entry.code}/claim?t=${encodeURIComponent(entry.token)}&to=${to}`;
  },
};
