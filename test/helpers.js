// Test helpers: a fake FACEIT API so tests never touch the network or need a key.

export const PLAYER_A = { player_id: "aaaaaaaa-0000-0000-0000-000000000001", nickname: "alpha", games: { cs2: { faceit_elo: 2100, skill_level: 10 } } };
export const PLAYER_B = { player_id: "bbbbbbbb-0000-0000-0000-000000000002", nickname: "bravo", games: { cs2: { faceit_elo: 1800, skill_level: 8 } } };

/** Raw FACEIT search results, deliberately fuzzy and messy. */
export const SEARCH_ITEMS = [
  { player_id: "p1", nickname: "s0m", country: "us", avatar: "https://assets.faceit-cdn.net/avatars/p1.jpg", verified: true, games: [{ name: "cs2", skill_level: "4" }] },
  { player_id: "p2", nickname: "xs1mplex", country: "ua", games: [{ name: "cs2", skill_level: "7" }] },
  { player_id: "p3", nickname: "s1mpleton", country: "de", avatar: "https://evil.example/x.png", games: [{ name: "cs2", skill_level: "10" }] },
  { player_id: "p4", nickname: "s1m", country: "gb", games: [{ name: "cs2", skill_level: "0" }] },
  { player_id: "p5", nickname: "s1mNoLevel", country: "fr", games: [{ name: "cs2", skill_level: "0" }] },
  { player_id: "p6", nickname: "s1mCsgoOnly", games: [{ name: "csgo", skill_level: "9" }] },
  { player_id: "p7", nickname: "<script>", games: [{ name: "cs2", skill_level: "5" }] },
  { player_id: "p8", nickname: "S1MPLETON", games: [{ name: "cs2", skill_level: "3" }] },
];

/**
 * @param {string} id
 * @param {string[]} faction1
 * @param {string[]} faction2
 * @param {string} [winner]
 */
export function match(id, faction1, faction2, winner = "faction1") {
  return {
    match_id: id,
    finished_at: 1760000000,
    competition_name: "5v5 RANKED",
    results: { winner },
    teams: {
      faction1: { players: faction1.map((player_id) => ({ player_id })) },
      faction2: { players: faction2.map((player_id) => ({ player_id })) },
    },
  };
}

/** @param {number} status @param {unknown} [body] @param {Record<string,string>} [headers] */
export function jsonResponse(status, body = {}, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/**
 * Builds a fetch replacement from a route function and records every call.
 * @param {(url: URL, init: RequestInit) => Response | Promise<Response>} route
 */
export function fakeFetch(route) {
  /** @type {Array<{ url: URL, init: RequestInit }>} */
  const calls = [];
  /** @type {typeof fetch} */
  const fn = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return route(url, init);
  };
  return Object.assign(fn, { calls });
}

/** A fake FACEIT API with two players who shared two matches. */
export function standardFaceit() {
  const history = {
    [PLAYER_A.player_id]: [
      match("1-match-together", [PLAYER_A.player_id, PLAYER_B.player_id], ["x1"], "faction1"),
      match("1-match-against", [PLAYER_A.player_id], [PLAYER_B.player_id], "faction2"),
      match("1-match-only-a", [PLAYER_A.player_id], ["x2"]),
    ],
    [PLAYER_B.player_id]: [
      match("1-match-together", [PLAYER_A.player_id, PLAYER_B.player_id], ["x1"], "faction1"),
      match("1-match-against", [PLAYER_A.player_id], [PLAYER_B.player_id], "faction2"),
    ],
  };
  return fakeFetch((url) => {
    const path = url.pathname.replace("/data/v4", "");
    if (path === "/players") {
      const nick = url.searchParams.get("nickname")?.toLowerCase();
      if (nick === "alpha") return jsonResponse(200, PLAYER_A);
      if (nick === "bravo") return jsonResponse(200, PLAYER_B);
      return jsonResponse(404, { errors: [] });
    }
    if (path === "/search/players") {
      return jsonResponse(200, { items: SEARCH_ITEMS });
    }
    const stats = path.match(/^\/players\/([^/]+)\/stats\/cs2$/);
    if (stats) {
      return jsonResponse(200, { lifetime: { Matches: "500", "Win Rate %": "54", "Average K/D Ratio": "1.2", "Average Headshots %": "48", "Longest Win Streak": "9", Secret: "should-not-leak" } });
    }
    const hist = path.match(/^\/players\/([^/]+)\/history$/);
    if (hist) {
      const offset = Number(url.searchParams.get("offset"));
      const items = offset === 0 ? (history[decodeURIComponent(hist[1])] ?? []) : [];
      return jsonResponse(200, { items });
    }
    return jsonResponse(404);
  });
}

/** Config for tests, with generous limits unless overridden. */
export function testConfig(overrides = {}) {
  return {
    nodeEnv: "test",
    isProduction: false,
    port: 0,
    faceitApiKey: "test-key",
    trustProxy: false,
    maxMatchesPerPlayer: 200,
    compareRateLimitPerMinute: 100,
    searchRateLimitPerMinute: 1000,
    globalRateLimitPerMinute: 1000,
    upstreamConcurrency: 4,
    upstreamQueueLimit: 100,
    upstreamTimeoutMs: 1000,
    ...overrides,
  };
}
