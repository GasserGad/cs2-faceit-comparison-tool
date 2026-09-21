import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getPlayerByNickname,
  getPlayerStats,
  getPlayerMatchHistory,
} from "../src/faceitClient.js";

const realFetch = globalThis.fetch;
const realKey = process.env.FACEIT_API_KEY;

beforeEach(() => {
  process.env.FACEIT_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.FACEIT_API_KEY;
  else process.env.FACEIT_API_KEY = realKey;
});

const reply = (body, status = 200, statusText = "OK") =>
  new Response(JSON.stringify(body), { status, statusText });

// A history endpoint that has `available` matches in total.
function stubHistory(available, calls) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const offset = Number(u.searchParams.get("offset"));
    const limit = Number(u.searchParams.get("limit"));
    calls.push({ offset, limit });
    const count = Math.max(0, Math.min(limit, available - offset));
    return reply({ items: Array.from({ length: count }, (_, i) => ({ match_id: `m${offset + i}` })) });
  };
}

test("history pages through results until the player runs out of matches", async () => {
  const calls = [];
  stubHistory(230, calls);

  const matches = await getPlayerMatchHistory("p1", "cs2", 500);

  assert.equal(matches.length, 230);
  assert.deepEqual(calls, [
    { offset: 0, limit: 100 },
    { offset: 100, limit: 100 },
    { offset: 200, limit: 100 },
  ]);
});

test("history stops at maxMatches and trims the last page", async () => {
  const calls = [];
  stubHistory(1000, calls);

  const matches = await getPlayerMatchHistory("p1", "cs2", 150);

  assert.equal(matches.length, 150);
  assert.equal(matches.at(-1).match_id, "m149");
  assert.deepEqual(calls, [
    { offset: 0, limit: 100 },
    { offset: 100, limit: 100 },
  ]);
});

test("every history request uses a page-aligned offset (Faceit 400s otherwise)", async () => {
  for (const depth of [1, 30, 130, 175, 321, 500]) {
    const calls = [];
    stubHistory(1000, calls);
    const matches = await getPlayerMatchHistory("p1", "cs2", depth);

    assert.equal(matches.length, depth, `depth ${depth}`);
    for (const { offset, limit } of calls) {
      assert.equal(limit, 100);
      assert.equal(offset % 100, 0, `depth ${depth}: offset ${offset}`);
    }
  }
});

test("sends the API key as a bearer token", async () => {
  let auth;
  globalThis.fetch = async (_url, opts) => {
    auth = opts.headers.Authorization;
    return reply({ player_id: "p1" });
  };
  await getPlayerByNickname("Alice");
  assert.equal(auth, "Bearer test-key");
});

test("unknown nickname is a 404 with a helpful message", async () => {
  globalThis.fetch = async () => reply({}, 404, "Not Found");
  await assert.rejects(getPlayerByNickname("nobody"), (err) => {
    assert.equal(err.status, 404);
    assert.match(err.message, /"nobody" not found/);
    return true;
  });
});

test("a player with no CS2 stats is a 404", async () => {
  globalThis.fetch = async () => reply({}, 404, "Not Found");
  await assert.rejects(getPlayerStats("p1"), (err) => err.status === 404);
});

test("a rejected API key becomes a 500 that names the key", async () => {
  globalThis.fetch = async () => reply({}, 401, "Unauthorized");
  await assert.rejects(getPlayerByNickname("Alice"), (err) => {
    assert.equal(err.status, 500);
    assert.match(err.message, /API key/);
    return true;
  });
});

test("rate limiting is passed through as 429", async () => {
  globalThis.fetch = async () => reply({}, 429, "Too Many Requests");
  await assert.rejects(getPlayerByNickname("Alice"), (err) => err.status === 429);
});

test("other Faceit errors become 502", async () => {
  globalThis.fetch = async () => reply({}, 503, "Service Unavailable");
  await assert.rejects(getPlayerByNickname("Alice"), (err) => err.status === 502);
});

test("network failure or timeout becomes 502", async () => {
  globalThis.fetch = async () => {
    throw new Error("connect ETIMEDOUT");
  };
  await assert.rejects(getPlayerByNickname("Alice"), (err) => {
    assert.equal(err.status, 502);
    assert.match(err.message, /Could not reach Faceit/);
    return true;
  });
});

test("missing API key is a 500 and never calls Faceit", async () => {
  delete process.env.FACEIT_API_KEY;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return reply({});
  };
  await assert.rejects(getPlayerByNickname("Alice"), (err) => err.status === 500);
  assert.equal(called, false);
});
