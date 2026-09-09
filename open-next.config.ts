import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext configuration for Cloudflare Workers.
 *
 * Deliberately bare. Every route in this app is `force-dynamic` and every API
 * response is sent `no-store` — a live classroom has nothing cacheable in it —
 * so no incremental cache, tag cache or queue is configured. That also keeps
 * the deployment to a single Worker with no KV, R2 or D1 resources to provision
 * before September 13.
 */
export default defineCloudflareConfig();
