import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

function getClient() {
  if (client !== undefined) return client;
  const url = process.env.REDIS_REST_URL;
  const token = process.env.REDIS_REST_TOKEN;
  if (!url || !token) {
    client = null;
    return client;
  }
  client = new Redis({ url, token });
  return client;
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const redis = getClient();
  if (!redis) {
    if (process.env.REQUIRE_REDIS === "true") {
      throw new Error("Redis is required but REDIS_REST_URL or REDIS_REST_TOKEN is missing.");
    }
    return { allowed: true, remaining: limit, configured: false };
  }

  const bucket = `blueprint:ratelimit:${key}`;
  const count = await redis.incr(bucket);
  // Refresh the expiry on every request so a counter never survives without a
  // TTL, even if the process crashed between the increment and the first expire.
  await redis.expire(bucket, windowSeconds);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), configured: true };
}

/**
 * Compaction for a small Redis budget (e.g. Upstash's 256 MB free tier). Every
 * key Blueprint writes carries a TTL, so memory is self-bounding; this sweep is
 * a safety net that removes any rate-limit counter that lost its expiry (a
 * crashed process, for example). Called on demand from the monitoring console.
 */
export async function runRedisSweep() {
  const redis = getClient();
  if (!redis) return { configured: false, scanned: 0, removed: 0, keysBefore: 0 };
  try {
    const keys = await redis.keys("blueprint:ratelimit:*");
    const bucketKeys = (Array.isArray(keys) ? keys : []).flat().filter((key): key is string => typeof key === "string");
    let removed = 0;
    for (const key of bucketKeys) {
      const ttl = await redis.ttl(key);
      // -1 means the key exists without an expiry — exactly the leak this sweep exists to fix.
      if (typeof ttl === "number" && ttl < 0) {
        await redis.del(key);
        removed += 1;
      }
    }
    return { configured: true, scanned: bucketKeys.length, removed, keysBefore: bucketKeys.length };
  } catch (error) {
    return { configured: false, scanned: 0, removed: 0, keysBefore: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
