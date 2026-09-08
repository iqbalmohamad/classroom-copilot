/**
 * Server-side environment access.
 *
 * Nothing in this file may be imported from a Client Component: every value
 * here is a secret or an operational detail that must stay on the server.
 */
import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See README.md ("Environment variables").`,
    );
  }
  return value;
}

export function databaseUrl(): string {
  return required("DATABASE_URL");
}

/** Anthropic API key for the optional AI Class Read feature. Absent = feature off. */
export function aiApiKey(): string | null {
  return process.env.AI_API_KEY?.trim() || null;
}

export function aiModel(): string {
  return process.env.AI_MODEL?.trim() || "claude-haiku-4-5-20251001";
}

export function isAiEnabled(): boolean {
  return aiApiKey() !== null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
