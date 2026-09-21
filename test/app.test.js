import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { app } from "../src/app.js";

const realFetch = globalThis.fetch;
const realKey = process.env.FACEIT_API_KEY;
let server;

before(() => new Promise((resolve) => (server = app.listen(0, resolve))));
after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  process.env.FACEIT_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.FACEIT_API_KEY;
  else process.env.FACEIT_API_KEY = realKey;
});

// Uses node:http so it is not affected by the fetch stub below.
function get(path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      })
      .on("error", reject);
  });
}

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

const PLAYERS = {
  alice: { player_id: "A", nickname: "Alice", country: "us", games: { cs2: { skill_level: 5, faceit_elo: 1100, region: "NA" } } },
  bob: { player_id: "B", nickname: "Bob", country: "us", games: { cs2: { skill_level: 6, faceit_elo: 1200, region: "NA" } } },
};

const STATS = {
  A: { lifetime: { Matches: "100", "Win Rate %": "48", "Average K/D Ratio": "1.1", ADR: "80.5", "Average Headshots %": "40", "K/D Ratio": "510.63" } },
  B: { lifetime: { Matches: "200", "Win Rate %": "55", "Average K/D Ratio": "1.3", ADR: "90", "Average Headshots %": "45" } },
};

const factions = (f1, f2) => ({
  faction1: { players: f1.map((player_id) => ({ player_id })) },
  faction2: { players: f2.map((player_id) => ({ player_id })) },
});

const HISTORY = {
  A: [
    { match_id: "m1", finished_at: 1, competition_name: "Q", teams: factions(["A", "B"], ["x"]), results: { winner: "faction1" } },
    { match_id: "m2", finished_at: 2, competition_name: "Q", teams: factions(["A"], ["B"]), results: { winner: "faction2" } },
    { match_id: "m3", finished_at: 3, competition_name: "Q", teams: factions(["A"], ["y"]), results: { winner: "faction1" } },
  ],
  B: [
    { match_id: "m1", finished_at: 1, competition_name: "Q", teams: factions(["A", "B"], ["x"]), results: { winner: "faction1" } },
    { match_id: "m2", finished_at: 2, competition_name: "Q", teams: factions(["A"], ["B"]), results: { winner: "faction2" } },
  ],
};

function stubFaceit() {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/players")) {
      const player = PLAYERS[u.searchParams.get("nickname").toLowerCase()];
      return player ? reply(player) : reply({}, 404);
    }
    const stats = u.pathname.match(/\/players\/(\w+)\/stats\//);
    if (stats) return reply(STATS[stats[1]]);
    const history = u.pathname.match(/\/players\/(\w+)\/history/);
    if (history) return reply({ items: HISTORY[history[1]] });
    return reply({}, 404);
  };
}

test("GET / reports status", async () => {
  const { status, body } = await get("/");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
});

test("400 when a nickname is missing", async () => {
  const { status } = await get("/compare?a=Alice");
  assert.equal(status, 400);
});

test("400 when both nicknames are the same, ignoring case", async () => {
  const { status } = await get("/compare?a=Alice&b=alice");
  assert.equal(status, 400);
});

test("400 for an invalid depth", async () => {
  for (const depth of ["0", "-5", "abc", "1.5", "501"]) {
    const { status } = await get(`/compare?a=Alice&b=Bob&depth=${depth}`);
    assert.equal(status, 400, `depth=${depth}`);
  }
});

test("404 when a player does not exist", async () => {
  stubFaceit();
  const { status, body } = await get("/compare?a=Alice&b=Nobody");
  assert.equal(status, 404);
  assert.match(body.error, /"Nobody" not found/);
});

test("500 when the API key is missing", async () => {
  delete process.env.FACEIT_API_KEY;
  const { status, body } = await get("/compare?a=Alice&b=Bob");
  assert.equal(status, 500);
  assert.match(body.error, /FACEIT_API_KEY/);
});

test("502 when Faceit is unreachable", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const { status } = await get("/compare?a=Alice&b=Bob");
  assert.equal(status, 502);
});

test("200 returns clean numbers and the head-to-head record", async () => {
  stubFaceit();
  const { status, body } = await get("/compare?a=alice&b=BOB");

  assert.equal(status, 200);

  const [alice, bob] = body.players;
  assert.equal(alice.nickname, "Alice"); // canonical spelling from Faceit
  assert.equal(alice.winRate, 48); // a number, not the string "48"
  assert.equal(alice.avgKd, 1.1); // the average, not the 510.63 running total
  assert.equal(alice.level, 5);
  assert.equal(bob.adr, 90);

  assert.deepEqual(body.matchesChecked, { Alice: 3, Bob: 2 });
  assert.equal(body.headToHead.totalShared, 2);
  assert.deepEqual(body.headToHead.asTeammates, { played: 1, won: 1, lost: 0 });
  assert.deepEqual(body.headToHead.asOpponents, { played: 1, wins: { Alice: 0, Bob: 1 } });
  assert.equal(body.sharedMatches.length, 2);
});
