// Nickname suggestions for the "search as you type" boxes.
//
// FACEIT's search is fuzzy ("s1m" can return "s0m" first), so results are
// re-ranked here: exact match, then names starting with the query, then names
// containing it, then the rest. Only a small whitelisted set of fields leaves
// the server, and avatar URLs are only passed through from FACEIT's CDN.
//
// The search endpoint reports every player's skill level as 0, so levels are
// neither shown nor used for filtering; the full comparison shows real levels.

const NICKNAME = /^[A-Za-z0-9_.-]{2,32}$/;
const COUNTRY = /^[a-z]{2}$/i;

/** Image hosts FACEIT serves avatars from. Also allowed in the page's CSP. */
export const AVATAR_HOSTS = Object.freeze(["assets.faceit-cdn.net", "distribution.faceit-cdn.net"]);

/**
 * @typedef {object} PlayerSuggestion
 * @property {string} nickname
 * @property {string | null} avatar
 * @property {string | null} country two-letter code, upper case
 * @property {boolean} verified
 */

/** @param {unknown} value */
function safeAvatar(value) {
  if (typeof value !== "string" || value.length > 300) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && AVATAR_HOSTS.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/** @param {string} nickname @param {string} query lower-cased */
function rank(nickname, query) {
  const name = nickname.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

/**
 * Turns raw FACEIT search items into ranked, whitelisted suggestions.
 * Players without a CS2 profile are dropped.
 * @param {any[]} items
 * @param {string} query
 * @param {number} maxResults
 * @returns {PlayerSuggestion[]}
 */
export function toSuggestions(items, query, maxResults) {
  const q = query.toLowerCase();
  const seen = new Set();
  /** @type {Array<{ suggestion: PlayerSuggestion, rank: number, index: number }>} */
  const ranked = [];

  items.forEach((item, index) => {
    const nickname = item?.nickname;
    if (typeof nickname !== "string" || !NICKNAME.test(nickname)) return;
    if (seen.has(nickname.toLowerCase())) return;
    const cs2 = Array.isArray(item.games) ? item.games.find((/** @type {any} */ g) => g?.name === "cs2") : undefined;
    if (!cs2) return;
    seen.add(nickname.toLowerCase());
    ranked.push({
      rank: rank(nickname, q),
      index,
      suggestion: {
        nickname,
        avatar: safeAvatar(item.avatar),
        country: typeof item.country === "string" && COUNTRY.test(item.country) ? item.country.toUpperCase() : null,
        verified: item.verified === true,
      },
    });
  });

  ranked.sort((x, y) => x.rank - y.rank || x.index - y.index);
  return ranked.slice(0, maxResults).map((r) => r.suggestion);
}

/**
 * @param {{ faceit: import("./faceitClient.js").FaceitClient, maxResults?: number }} deps
 */
export function createSearchService({ faceit, maxResults = 6 }) {
  return {
    /**
     * @param {string} query validated nickname prefix
     * @returns {Promise<PlayerSuggestion[]>}
     */
    async search(query) {
      const items = await faceit.searchPlayers(query);
      return toSuggestions(items, query, maxResults);
    },
  };
}
