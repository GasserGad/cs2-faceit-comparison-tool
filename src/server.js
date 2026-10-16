import "dotenv/config";
import { createApp } from "./app.js";
import { createCompareService } from "./compare.js";
import { loadConfig } from "./config.js";
import { createFaceitClient } from "./faceitClient.js";
import { ConcurrencyLimiter } from "./limiter.js";
import { createLogger } from "./logger.js";

const log = createLogger({ level: process.env.LOG_LEVEL === "debug" ? "debug" : "info" });

let config;
try {
  config = loadConfig();
} catch (err) {
  log("error", "invalid configuration", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

if (!config.faceitApiKey) {
  log("warn", "FACEIT_API_KEY is not set; /api/compare will return 503 until it is");
}

const limiter = new ConcurrencyLimiter({
  concurrency: config.upstreamConcurrency,
  queueLimit: config.upstreamQueueLimit,
});
const faceit = createFaceitClient({
  apiKey: config.faceitApiKey,
  timeoutMs: config.upstreamTimeoutMs,
  limiter,
  log,
});
const compareService = createCompareService({ faceit, maxMatchesPerPlayer: config.maxMatchesPerPlayer });
const app = createApp({ config, compareService, log });

const server = app.listen(config.port, () => {
  log("info", "server listening", { port: config.port, env: config.nodeEnv });
});

// Slow-client protection (slowloris-style attacks): cap how long a client may
// take to send headers and the full request, and how long idle sockets live.
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;

// Graceful shutdown so deploys don't cut off in-flight requests.
/** @param {string} signal */
function shutdown(signal) {
  log("info", "shutting down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  log("error", "unhandled promise rejection", { error: String(reason) });
});
