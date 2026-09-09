/**
 * Classroom material links.
 *
 * The instructor pastes URLs from a deck — a dataset, an install guide, the LMS
 * submission page — and learners tap them on a phone. Only http and https are
 * ever stored: `javascript:`, `data:` and friends turn a shared classroom list
 * into a way to run something in every learner's browser, and nothing about a
 * seed-script link needs a scheme that can execute.
 */

const MAX_URL_LENGTH = 2000;

export function safeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;

  // A bare "example.com/guide" is what people paste; assume https rather than
  // rejecting it, but never assume a scheme for something that already has one.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  // user:password@host in a link shown to a class is a phishing shape and never
  // a legitimate way to share a guide.
  if (url.username || url.password) return null;

  const normalised = url.toString();
  return normalised.length <= MAX_URL_LENGTH ? normalised : null;
}

/** Short, readable form for a link on a phone: host plus a hint of the path. */
export function linkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`.slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
}
