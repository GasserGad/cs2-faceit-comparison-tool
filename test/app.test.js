import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createCompareService } from "../src/compare.js";
import { createFaceitClient } from "../src/faceitClient.js";
import { ConcurrencyLimiter } from "../src/limiter.js";
import { createSearchService } from "../src/search.js";
import { fakeFetch, jsonResponse, standardFaceit, testConfig } from "./helpers.js";

/** @param {{ fetchImpl?: typeof fetch, config?: object, compareService?: any, searchService?: any }} [options] */
function buildApp({ fetchImpl = standardFaceit(), config = {}, compareService, searchService } = {}) {
  const cfg = testConfig(config);
  const faceit = createFaceitClient({
    apiKey: cfg.faceitApiKey,
    timeoutMs: cfg.upstreamTimeoutMs,
    limiter: new ConcurrencyLimiter({ concurrency: cfg.upstreamConcurrency, queueLimit: cfg.upstreamQueueLimit }),
    fetchImpl,
    retryDelayMs: 1,
  });
  return createApp({
    config: cfg,
    compareService: compareService ?? createCompareService({ faceit, maxMatchesPerPlayer: cfg.maxMatchesPerPlayer }),
    searchService: searchService ?? createSearchService({ faceit }),
  });
}

describe("GET /api/compare", () => {
  it("returns players, a summary and shared matches", async () => {
    const res = await request(buildApp()).get("/api/compare?a=alpha&b=bravo").expect(200);
    assert.equal(res.body.playerA.nickname, "alpha");
    assert.equal(res.body.playerB.elo, 1800);
    assert.deepEqual(res.body.summary, {
      totalShared: 2,
      teammates: { played: 1, won: 1 },
      opponents: { played: 1, playerAWins: 0, playerBWins: 1 },
    });
    assert.equal(res.body.sharedMatches.length, 2);
  });

  it("only returns whitelisted stat fields", async () => {
    const res = await request(buildApp()).get("/api/compare?a=alpha&b=bravo").expect(200);
    assert.equal(JSON.stringify(res.body).includes("should-not-leak"), false);
    assert.deepEqual(Object.keys(res.body.playerA.stats).sort(), ["headshotPercent", "kdRatio", "longestWinStreak", "matches", "winRatePercent"]);
  });

  it("returns 404 for an unknown player", async () => {
    const res = await request(buildApp()).get("/api/compare?a=alpha&b=nobody").expect(404);
    assert.equal(res.body.error.code, "player_not_found");
  });

  for (const query of ["", "?a=alpha", "?a=alpha&b=<script>", "?a=alpha&a=x1&b=bravo", "?a=alpha&b=ALPHA", "?a[$ne]=1&b=bravo"]) {
    it(`rejects bad input: "${query}"`, async () => {
      const res = await request(buildApp()).get(`/api/compare${query}`).expect(400);
      assert.equal(res.body.error.code, "bad_request");
    });
  }

  it("hides upstream details when FACEIT fails", async () => {
    const res = await request(buildApp({ fetchImpl: fakeFetch(() => jsonResponse(500, { secret: "internal" })) }))
      .get("/api/compare?a=alpha&b=bravo")
      .expect(502);
    assert.equal(res.body.error.code, "upstream_error");
    assert.equal(JSON.stringify(res.body).includes("internal"), false);
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const broken = { compare: async () => { throw new Error("db password is hunter2"); } };
    const res = await request(buildApp({ compareService: broken })).get("/api/compare?a=alpha&b=bravo").expect(500);
    assert.deepEqual(res.body, { error: { code: "internal_error", message: "Something went wrong." } });
  });

  it("rate limits comparisons per client", async () => {
    const app = buildApp({ config: { compareRateLimitPerMinute: 2 } });
    await request(app).get("/api/compare?a=alpha&b=bravo").expect(200);
    await request(app).get("/api/compare?a=alpha&b=bravo").expect(200);
    const res = await request(app).get("/api/compare?a=alpha&b=bravo").expect(429);
    assert.equal(res.body.error.code, "rate_limited");
    assert.ok(res.headers["ratelimit-policy"] || res.headers.ratelimit, "standard rate-limit headers present");
  });

  it("ignores spoofed X-Forwarded-For when no proxy is trusted", async () => {
    const app = buildApp({ config: { compareRateLimitPerMinute: 1 } });
    await request(app).get("/api/compare?a=alpha&b=bravo").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await request(app).get("/api/compare?a=alpha&b=bravo").set("X-Forwarded-For", "2.2.2.2").expect(429);
  });
});

describe("GET /api/search", () => {
  it("returns ranked, whitelisted suggestions", async () => {
    const res = await request(buildApp()).get("/api/search?q=s1m").expect(200);
    assert.deepEqual(
      res.body.players.map((/** @type {any} */ p) => p.nickname),
      ["s1m", "s1mpleton", "s1mNoLevel", "xs1mplex", "s0m"]
    );
    assert.deepEqual(Object.keys(res.body.players[0]).sort(), ["avatar", "country", "nickname", "verified"]);
    assert.match(res.headers["cache-control"], /max-age=300/);
  });

  it("only passes avatars from FACEIT's CDN", async () => {
    const res = await request(buildApp()).get("/api/search?q=s1m").expect(200);
    const byName = Object.fromEntries(res.body.players.map((/** @type {any} */ p) => [p.nickname, p]));
    assert.equal(byName.s0m.avatar, "https://assets.faceit-cdn.net/avatars/p1.jpg");
    assert.equal(byName.s1mpleton.avatar, null);
    assert.equal(JSON.stringify(res.body).includes("evil.example"), false);
  });

  it("does not leak FACEIT player IDs", async () => {
    const res = await request(buildApp()).get("/api/search?q=s1m").expect(200);
    assert.equal(JSON.stringify(res.body).includes("player_id"), false);
  });

  for (const query of ["", "?q=x", "?q=<script>", "?q=a&q=b", `?q=${"a".repeat(33)}`, "?q[$ne]=1"]) {
    it(`rejects bad input: "${query}"`, async () => {
      const res = await request(buildApp()).get(`/api/search${query}`).expect(400);
      assert.equal(res.body.error.code, "bad_request");
    });
  }

  it("caches prefixes so repeated typing doesn't cost API quota", async () => {
    const fetchImpl = standardFaceit();
    const app = buildApp({ fetchImpl });
    await request(app).get("/api/search?q=s1m").expect(200);
    await request(app).get("/api/search?q=S1M").expect(200);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url.searchParams.get("game"), "cs2");
  });

  it("rate limits searches per client", async () => {
    const app = buildApp({ config: { searchRateLimitPerMinute: 2 } });
    await request(app).get("/api/search?q=s1m").expect(200);
    await request(app).get("/api/search?q=s1m").expect(200);
    const res = await request(app).get("/api/search?q=s1m").expect(429);
    assert.equal(res.body.error.code, "rate_limited");
  });

  it("hides upstream details when FACEIT fails", async () => {
    const res = await request(buildApp({ fetchImpl: fakeFetch(() => jsonResponse(500, { secret: "internal" })) }))
      .get("/api/search?q=s1m")
      .expect(502);
    assert.equal(JSON.stringify(res.body).includes("internal"), false);
  });

  it("returns an empty list when nothing matches", async () => {
    const res = await request(buildApp({ fetchImpl: fakeFetch(() => jsonResponse(200, { items: [] })) }))
      .get("/api/search?q=zzzz")
      .expect(200);
    assert.deepEqual(res.body, { players: [] });
  });
});

describe("HTTP hardening", () => {
  it("sets security headers and hides the framework", async () => {
    const res = await request(buildApp()).get("/").expect(200);
    assert.equal(res.headers["x-powered-by"], undefined);
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.match(res.headers["content-security-policy"], /img-src 'self' data: https:\/\/assets\.faceit-cdn\.net/);
    assert.equal(res.headers["cross-origin-embedder-policy"], "credentialless");
    assert.ok(res.headers["x-request-id"]);
  });

  it("rejects methods other than GET", async () => {
    const res = await request(buildApp()).post("/api/compare").send({ a: "alpha" }).expect(405);
    assert.equal(res.headers.allow, "GET, HEAD");
  });

  it("rejects very long URLs", async () => {
    await request(buildApp()).get(`/api/compare?a=${"x".repeat(600)}&b=bravo`).expect(414);
  });

  it("serves the legal pages", async () => {
    const terms = await request(buildApp()).get("/terms").expect(200);
    assert.match(terms.text, /Terms of Use/);
    const privacy = await request(buildApp()).get("/privacy").expect(200);
    assert.match(privacy.text, /Privacy Policy/);
  });

  it("returns 404 for unknown API routes and pages", async () => {
    await request(buildApp()).get("/api/nope").expect(404);
    await request(buildApp()).get("/nope").expect(404);
  });

  it("does not serve files outside the public folder", async () => {
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fsrc%2fconfig.js", "/.env"]) {
      const res = await request(buildApp()).get(path);
      assert.notEqual(res.status, 200, path);
      assert.equal(res.text.includes("faceitApiKey"), false, path);
    }
  });

  it("reports health without caching", async () => {
    const res = await request(buildApp()).get("/healthz").expect(200);
    assert.equal(res.headers["cache-control"], "no-store");
  });
});
