import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TtlCache } from "../src/cache.js";
import { findSharedMatches, summarize } from "../src/compare.js";
import { loadConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import { ConcurrencyLimiter } from "../src/limiter.js";
import { toSuggestions } from "../src/search.js";
import { parseCompareQuery, parseNickname, parseSearchQuery } from "../src/validation.js";
import { match, PLAYER_A, PLAYER_B } from "./helpers.js";

describe("validation", () => {
  it("accepts normal nicknames and trims spaces", () => {
    assert.equal(parseNickname("  s1mple ", "a"), "s1mple");
    assert.equal(parseNickname("Ze_Us-2.0", "a"), "Ze_Us-2.0");
  });

  for (const bad of [undefined, "", "x", "a".repeat(33), "<script>", "name with space", "../etc", "名前", ["a1", "b2"], { $ne: 1 }]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => parseNickname(bad, "a"), (err) => err instanceof AppError && err.status === 400);
    });
  }

  it("validates search queries like nicknames", () => {
    assert.equal(parseSearchQuery({ q: " s1 " }), "s1");
    assert.throws(() => parseSearchQuery({ q: "s" }), (err) => err instanceof AppError && err.status === 400);
  });

  it("rejects comparing a player with themselves (case-insensitive)", () => {
    assert.throws(() => parseCompareQuery({ a: "Alpha", b: "alpha" }), /two different players/);
  });
});

describe("TtlCache", () => {
  it("expires entries after the TTL", () => {
    let now = 0;
    const cache = new TtlCache({ maxEntries: 10, ttlMs: 100, now: () => now });
    cache.set("k", 1);
    assert.equal(cache.get("k"), 1);
    now = 101;
    assert.equal(cache.get("k"), undefined);
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new TtlCache({ maxEntries: 2, ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a is now most recent
    cache.set("c", 3);
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.size, 2);
  });

  it("runs the loader once for concurrent requests and does not cache failures", async () => {
    const cache = new TtlCache({ maxEntries: 10, ttlMs: 1000 });
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    const [x, y] = await Promise.all([cache.getOrLoad("k", load), cache.getOrLoad("k", load)]);
    assert.deepEqual([x, y, calls], [1, 1, 1]);

    await assert.rejects(cache.getOrLoad("bad", async () => { throw new Error("boom"); }));
    assert.equal(await cache.getOrLoad("bad", async () => "ok"), "ok");
  });
});

describe("ConcurrencyLimiter", () => {
  it("never runs more tasks than allowed at once", async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 2, queueLimit: 10 });
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    };
    await Promise.all(Array.from({ length: 8 }, () => limiter.run(task)));
    assert.equal(peak, 2);
    assert.equal(limiter.active, 0);
  });

  it("sheds load with a 503 when the queue is full", async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 1, queueLimit: 1 });
    let release = () => {};
    const blocker = limiter.run(() => new Promise((r) => { release = () => r(undefined); }));
    const queued = limiter.run(async () => "queued");
    await assert.rejects(limiter.run(async () => "rejected"), (err) => err instanceof AppError && err.status === 503);
    release();
    await blocker;
    assert.equal(await queued, "queued");
  });
});

describe("shared match logic", () => {
  const a = PLAYER_A.player_id;
  const b = PLAYER_B.player_id;

  it("labels teammates and opponents with results from A's side", () => {
    const together = match("1-together0", [a, b], ["x"], "faction1");
    const against = match("1-against00", [a], [b], "faction2");
    const shared = findSharedMatches([together, against, match("1-only-a000", [a], ["y"])], a, [together, against], b);
    assert.equal(shared.length, 2);
    const byId = Object.fromEntries(shared.map((m) => [m.matchId, m]));
    assert.equal(byId["1-together0"].relationship, "teammates");
    assert.equal(byId["1-together0"].playerAWon, true);
    assert.equal(byId["1-against00"].relationship, "opponents");
    assert.equal(byId["1-against00"].playerAWon, false);

    assert.deepEqual(summarize(shared), {
      totalShared: 2,
      teammates: { played: 1, won: 1 },
      opponents: { played: 1, playerAWins: 0, playerBWins: 1 },
    });
  });

  it("skips matches where a roster is missing instead of guessing", () => {
    const broken = { match_id: "1-broken000", teams: { faction1: { players: [{ player_id: a }] } } };
    assert.equal(findSharedMatches([broken], a, [broken], b).length, 0);
  });

  it("counts a duplicated match only once", () => {
    const m = match("1-dupe00000", [a, b], ["x"]);
    assert.equal(findSharedMatches([m, m], a, [m], b).length, 1);
  });
});

describe("search suggestions", () => {
  /** @param {string} nickname @param {string} [level] @param {object} [extra] */
  const item = (nickname, level = "5", extra = {}) => ({ nickname, games: [{ name: "cs2", skill_level: level }], ...extra });

  it("ranks exact, then prefix, then contains, then fuzzy, keeping FACEIT order within a rank", () => {
    const items = [item("a-b"), item("abc"), item("xxab1"), item("ab2"), item("ab"), item("ab3")];
    assert.deepEqual(toSuggestions(items, "AB", 10).map((s) => s.nickname), ["ab", "abc", "ab2", "ab3", "xxab1", "a-b"]);
  });

  it("caps the number of results", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`ab${i}`));
    assert.equal(toSuggestions(items, "ab", 6).length, 6);
  });

  it("normalizes country and level, and drops bad values", () => {
    const [s] = toSuggestions([item("ab", "11", { country: "usa", verified: "yes" })], "ab", 5);
    assert.deepEqual(s, { nickname: "ab", avatar: null, country: null, skillLevel: null, verified: false });
    const [t] = toSuggestions([item("ab", "8", { country: "us", verified: true })], "ab", 5);
    assert.equal(t.country, "US");
    assert.equal(t.skillLevel, 8);
  });

  it("only accepts https avatars on FACEIT's CDN", () => {
    const avatars = ["http://assets.faceit-cdn.net/a.jpg", "https://assets.faceit-cdn.net.evil.io/a.jpg", "javascript:alert(1)", "https://distribution.faceit-cdn.net/a.png"];
    const out = toSuggestions(avatars.map((avatar, i) => item(`ab${i}`, "5", { avatar })), "ab", 10);
    assert.deepEqual(out.map((s) => s.avatar), [null, null, null, "https://distribution.faceit-cdn.net/a.png"]);
  });

  it("ignores malformed items instead of failing", () => {
    assert.deepEqual(toSuggestions([null, {}, { nickname: 5 }, { nickname: "ab" }, { nickname: "ab", games: "x" }], "ab", 5), []);
  });
});

describe("config", () => {
  it("requires an API key in production", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "production" }), /FACEIT_API_KEY/);
  });

  it("rejects invalid numbers", () => {
    assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
    assert.throws(() => loadConfig({ TRUST_PROXY: "99" }), /TRUST_PROXY/);
  });

  it("does not trust proxy headers unless told to", () => {
    assert.equal(loadConfig({}).trustProxy, false);
    assert.equal(loadConfig({ TRUST_PROXY: "1" }).trustProxy, 1);
  });

  it("has a separate search rate limit", () => {
    assert.equal(loadConfig({}).searchRateLimitPerMinute, 60);
    assert.throws(() => loadConfig({ SEARCH_RATE_LIMIT_PER_MINUTE: "0" }), /SEARCH_RATE_LIMIT_PER_MINUTE/);
  });
});
