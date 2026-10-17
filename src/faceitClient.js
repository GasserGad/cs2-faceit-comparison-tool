// Thin, defensive wrapper over the FACEIT Data API v4.
//
// Hardening:
// - every request has a timeout, so a slow upstream cannot tie up the server
// - all calls go through a concurrency limiter with a bounded queue
// - 429 / 5xx responses are retried once, then surfaced as safe errors
// - IDs from upstream are validated before being put into URLs
// - results are cached (bounded, with TTL) to save API quota

import { TtlCache } from "./cache.js";
import { AppError, upstreamBusy, upstreamFailed } from "./errors.js";

const BASE_URL = "https://open.faceit.com/data/v4";
const HISTORY_PAGE_SIZE = 100; // FACEIT's maximum page size for match history
const GAME = "cs2";
// Fetch more than we show so re-ranking (exact/prefix first) has material.
const SEARCH_PAGE_SIZE = 20;
// FACEIT player and match IDs are UUIDs or "1-<uuid>" style match IDs.
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * @typedef {object} FaceitPlayer
 * @property {string} player_id
 * @property {string} nickname
 * @property {string} [avatar]
 * @property {string} [country]
 * @property {{ cs2?: { faceit_elo?: number, skill_level?: number } }} [games]
 */

/**
 * @typedef {object} FaceitHistoryItem
 * @property {string} match_id
 * @property {number} [finished_at]
 * @property {string} [competition_name]
 * @property {{ winner?: string }} [results]
 * @property {Record<string, { players?: Array<{ player_id: string }> }>} [teams]
 */

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} id */
function assertSafeId(id) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) {
    throw upstreamFailed(new Error("FACEIT returned an unexpected ID format"));
  }
  return id;
}

/**
 * @param {{
 *   apiKey: string,
 *   timeoutMs: number,
 *   limiter: import("./limiter.js").ConcurrencyLimiter,
 *   fetchImpl?: typeof fetch,
 *   log?: (level: string, message: string, fields?: object) => void,
 *   retryDelayMs?: number,
 * }} options
 */
export function createFaceitClient({ apiKey, timeoutMs, limiter, fetchImpl = fetch, log = () => {}, retryDelayMs = 300 }) {
  const playerCache = new TtlCache({ maxEntries: 2000, ttlMs: 10 * 60_000 });
  const statsCache = new TtlCache({ maxEntries: 2000, ttlMs: 10 * 60_000 });
  const historyCache = new TtlCache({ maxEntries: 1000, ttlMs: 5 * 60_000 });
  // Search-as-you-type sends many short prefixes; caching them saves quota.
  const searchCache = new TtlCache({ maxEntries: 2000, ttlMs: 10 * 60_000 });

  /**
   * @param {string} path already-encoded path
   * @param {Record<string, string | number>} [query]
   * @returns {Promise<any | null>} parsed JSON, or null on 404
   */
  async function request(path, query = {}) {
    if (!apiKey) {
      throw new AppError(503, "not_configured", "This server is missing its FACEIT API key.");
    }
    const url = new URL(BASE_URL + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      /** @type {Response} */
      let res;
      try {
        res = await limiter.run(() =>
          fetchImpl(url, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
            redirect: "error",
          })
        );
      } catch (err) {
        if (err instanceof AppError) throw err; // limiter queue full
        log("warn", "faceit request failed", { path: url.pathname, attempt, error: String(err) });
        if (attempt === 2) throw upstreamFailed(err);
        await sleep(retryDelayMs);
        continue;
      }

      if (res.ok) return res.json();
      if (res.status === 404) return null;

      if (res.status === 429 || res.status >= 500) {
        log("warn", "faceit transient error", { path: url.pathname, status: res.status, attempt });
        if (attempt === 2) {
          throw res.status === 429 ? upstreamBusy(retryAfterSeconds(res)) : upstreamFailed();
        }
        await sleep(Math.min(retryAfterSeconds(res) * 1000, 2000, retryDelayMs * 4));
        continue;
      }

      // 400/401/403 etc. are our bug or a bad key: log for the operator,
      // return a generic error to the client.
      log("error", "faceit rejected request", { path: url.pathname, status: res.status });
      throw upstreamFailed();
    }
    throw upstreamFailed();
  }

  return {
    /**
     * @param {string} nickname validated nickname
     * @returns {Promise<FaceitPlayer | null>}
     */
    getPlayerByNickname(nickname) {
      return playerCache.getOrLoad(nickname.toLowerCase(), async () => {
        const player = await request("/players", { nickname });
        if (player === null) return null;
        assertSafeId(player.player_id);
        return player;
      });
    },

    /**
     * Fuzzy nickname search for CS2 players (used for suggestions).
     * @param {string} query validated nickname prefix
     * @returns {Promise<any[]>} raw FACEIT search items
     */
    searchPlayers(query) {
      return searchCache.getOrLoad(query.toLowerCase(), async () => {
        const page = await request("/search/players", { nickname: query, game: GAME, offset: 0, limit: SEARCH_PAGE_SIZE });
        return Array.isArray(page?.items) ? page.items : [];
      });
    },

    /** @param {string} playerId */
    getPlayerStats(playerId) {
      const id = assertSafeId(playerId);
      return statsCache.getOrLoad(id, () =>
        request(`/players/${encodeURIComponent(id)}/stats/${GAME}`)
      );
    },

    /**
     * Recent match history, paging through FACEIT until `maxMatches`.
     * @param {string} playerId
     * @param {number} maxMatches
     * @returns {Promise<FaceitHistoryItem[]>}
     */
    getPlayerMatchHistory(playerId, maxMatches) {
      const id = assertSafeId(playerId);
      return historyCache.getOrLoad(`${id}:${maxMatches}`, async () => {
        /** @type {FaceitHistoryItem[]} */
        const items = [];
        for (let offset = 0; offset < maxMatches; offset += HISTORY_PAGE_SIZE) {
          const limit = Math.min(HISTORY_PAGE_SIZE, maxMatches - offset);
          const page = await request(`/players/${encodeURIComponent(id)}/history`, {
            game: GAME,
            offset,
            limit,
          });
          const pageItems = Array.isArray(page?.items) ? page.items : [];
          items.push(...pageItems);
          if (pageItems.length < limit) break;
        }
        return items;
      });
    },
  };
}

/** @param {Response} res */
function retryAfterSeconds(res) {
  const value = Number(res.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.ceil(value), 120) : 30;
}

/** @typedef {ReturnType<typeof createFaceitClient>} FaceitClient */
