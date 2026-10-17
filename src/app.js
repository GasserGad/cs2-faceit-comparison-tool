import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { AppError } from "./errors.js";
import { AVATAR_HOSTS } from "./search.js";
import { parseCompareQuery, parseSearchQuery } from "./validation.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MAX_URL_LENGTH = 512;

/**
 * @param {{
 *   config: import("./config.js").Config,
 *   compareService: ReturnType<typeof import("./compare.js").createCompareService>,
 *   searchService: ReturnType<typeof import("./search.js").createSearchService>,
 *   log?: (level: string, message: string, fields?: object) => void,
 * }} deps
 */
export function createApp({ config, compareService, searchService, log = () => {} }) {
  const app = express();

  app.disable("x-powered-by");
  // Only trust X-Forwarded-For from a known number of proxy hops (see config).
  app.set("trust proxy", config.trustProxy);
  // Express 5 default; stated explicitly: no nested objects from query strings.
  app.set("query parser", "simple");

  // Request ID + access log. IPs and query strings are not logged.
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.locals.requestId = requestId;
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      log("info", "request", { requestId, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
    });
    next();
  });

  // Read-only API: refuse anything but GET/HEAD and absurdly long URLs early.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: { code: "method_not_allowed", message: "Only GET is supported." } });
    }
    if (req.originalUrl.length > MAX_URL_LENGTH) {
      return res.status(414).json({ error: { code: "uri_too_long", message: "Request URL is too long." } });
    }
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          // Player avatars in the suggestions come from FACEIT's CDN only.
          imgSrc: ["'self'", "data:", ...AVATAR_HOSTS.map((host) => `https://${host}`)],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
      // "credentialless" still isolates the page but lets FACEIT avatars load
      // (they are fetched without cookies and don't send CORP headers).
      crossOriginEmbedderPolicy: { policy: "credentialless" },
      referrerPolicy: { policy: "no-referrer" },
    })
  );
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
    next();
  });

  /** @param {string} message */
  const tooMany = (message) => (/** @type {any} */ _req, /** @type {any} */ res) => {
    res.status(429).json({ error: { code: "rate_limited", message } });
  };

  // Site-wide limit per IP.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.globalRateLimitPerMinute,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: tooMany("Too many requests. Please slow down."),
    })
  );

  app.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok" });
  });

  // Each comparison triggers several FACEIT calls, so it gets a tighter limit.
  const compareLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.compareRateLimitPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany("Too many comparisons. Please wait a minute and try again."),
  });

  app.get("/api/compare", compareLimiter, async (req, res) => {
    const { a, b } = parseCompareQuery(req.query);
    const result = await compareService.compare(a, b);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(result);
  });

  // Suggestions fire while typing (debounced in the browser), so they get their
  // own limit; results are cached server-side per prefix.
  const searchLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.searchRateLimitPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany("Too many searches. Please slow down."),
  });

  app.get("/api/search", searchLimiter, async (req, res) => {
    const q = parseSearchQuery(req.query);
    const players = await searchService.search(q);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({ players });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Unknown API route." } });
  });

  app.use(
    express.static(PUBLIC_DIR, {
      dotfiles: "deny",
      index: "index.html",
      extensions: ["html"],
      maxAge: config.isProduction ? "1h" : 0,
    })
  );

  app.use((_req, res) => {
    res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  });

  // Central error handler: known errors get their safe message, everything
  // else is logged in full and returned as a generic 500.
  app.use(
    /**
     * @param {any} err
     * @param {import("express").Request} _req
     * @param {import("express").Response} res
     * @param {import("express").NextFunction} _next
     */
    (err, _req, res, _next) => {
      if (err instanceof AppError) {
        if (err.retryAfterSeconds) res.setHeader("Retry-After", String(err.retryAfterSeconds));
        if (err.status >= 500) {
          log("warn", "upstream problem", { requestId: res.locals.requestId, code: err.code, cause: String(err.cause ?? "") });
        }
        return res.status(err.status).json({ error: { code: err.code, message: err.message } });
      }
      // Malformed requests caught by Express itself (e.g. bad URL encoding).
      const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
      if (status === 500) {
        log("error", "unhandled error", { requestId: res.locals.requestId, error: err?.stack ?? String(err) });
      }
      res.status(status).json({
        error: { code: status === 500 ? "internal_error" : "bad_request", message: status === 500 ? "Something went wrong." : "Bad request." },
      });
    }
  );

  return app;
}
