// Reads and validates configuration once at startup. Invalid config fails fast
// with a clear message instead of misbehaving later in production.

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 * @param {string} name
 * @param {{ min?: number, max?: number }} [range]
 */
function intFromEnv(raw, fallback, name, range = {}) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = range;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

/**
 * Express "trust proxy" setting. Only trust X-Forwarded-For when you really are
 * behind a known number of proxies, otherwise clients can spoof their IP and
 * dodge rate limits.
 * @param {string | undefined} raw
 * @returns {number | false}
 */
function trustProxyFromEnv(raw) {
  if (raw === undefined || raw === "" || raw === "false" || raw === "0") return false;
  return intFromEnv(raw, 0, "TRUST_PROXY", { min: 1, max: 5 });
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const faceitApiKey = env.FACEIT_API_KEY ?? "";

  if (nodeEnv === "production" && !faceitApiKey) {
    throw new Error("FACEIT_API_KEY must be set in production");
  }

  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: intFromEnv(env.PORT, 3000, "PORT", { min: 1, max: 65535 }),
    faceitApiKey,
    trustProxy: trustProxyFromEnv(env.TRUST_PROXY),
    // How many recent matches to scan per player (FACEIT pages are 100 long).
    maxMatchesPerPlayer: intFromEnv(env.MAX_MATCHES_PER_PLAYER, 200, "MAX_MATCHES_PER_PLAYER", {
      min: 20,
      max: 1000,
    }),
    // Requests per minute per IP on the comparison endpoint.
    compareRateLimitPerMinute: intFromEnv(env.COMPARE_RATE_LIMIT_PER_MINUTE, 10, "COMPARE_RATE_LIMIT_PER_MINUTE", {
      min: 1,
      max: 1000,
    }),
    // Requests per minute per IP across the whole site.
    globalRateLimitPerMinute: intFromEnv(env.GLOBAL_RATE_LIMIT_PER_MINUTE, 120, "GLOBAL_RATE_LIMIT_PER_MINUTE", {
      min: 1,
      max: 10000,
    }),
    // Upstream protection: simultaneous FACEIT calls and how many may wait.
    upstreamConcurrency: intFromEnv(env.UPSTREAM_CONCURRENCY, 4, "UPSTREAM_CONCURRENCY", { min: 1, max: 50 }),
    upstreamQueueLimit: intFromEnv(env.UPSTREAM_QUEUE_LIMIT, 100, "UPSTREAM_QUEUE_LIMIT", { min: 0, max: 10000 }),
    upstreamTimeoutMs: intFromEnv(env.UPSTREAM_TIMEOUT_MS, 8000, "UPSTREAM_TIMEOUT_MS", { min: 500, max: 60000 }),
  });
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
