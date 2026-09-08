/**
 * In-memory token bucket, per server instance.
 *
 * This is not a distributed rate limiter and is not trying to be one. Its job
 * is to stop a single bored learner from flooding the question queue or the
 * join endpoint during a class. Serverless instances each keep their own
 * counters, which is fine for that purpose and costs no infrastructure.
 */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

export interface Limit {
  /** Bucket capacity (burst). */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
}

/**
 * Limits are sized for a classroom, not for an API tier. A whole campus can sit
 * behind one address, so anything keyed by IP has to stay well clear of what
 * legitimate simultaneous use looks like: thirty learners joining a room in the
 * same minute is normal, and so is a second instructor starting a class next
 * door.
 */
export const LIMITS = {
  join: { capacity: 60, refillPerSecond: 1 },
  question: { capacity: 6, refillPerSecond: 0.1 },
  vote: { capacity: 40, refillPerSecond: 1 },
  respond: { capacity: 40, refillPerSecond: 1 },
  createRoom: { capacity: 20, refillPerSecond: 0.1 },
} satisfies Record<string, Limit>;

export function allow(key: string, limit: Limit, now: number = Date.now()): boolean {
  // The automated suite creates dozens of rooms from one address in seconds.
  // Set only by tests/integration/setup.ts; never set it on a deployment.
  if (process.env.CC_DISABLE_RATE_LIMIT === "1") return true;

  if (buckets.size > MAX_KEYS) buckets.clear();

  const bucket = buckets.get(key) ?? { tokens: limit.capacity, updatedAt: now };
  const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
  const tokens = Math.min(limit.capacity, bucket.tokens + elapsedSeconds * limit.refillPerSecond);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return false;
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return true;
}

/** Test hook. */
export function resetLimits(): void {
  buckets.clear();
}
