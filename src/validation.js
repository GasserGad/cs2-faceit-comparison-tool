import { badRequest } from "./errors.js";

// FACEIT nicknames are short and use letters, digits, "-", "_" and ".".
// Rejecting everything else up front means odd input never reaches the
// upstream API, the cache keys or the logs.
const NICKNAME = /^[A-Za-z0-9_.-]{2,32}$/;

/**
 * @param {unknown} value raw query value (may be missing, an array, etc.)
 * @param {string} label which parameter, for the error message
 * @returns {string}
 */
export function parseNickname(value, label) {
  if (typeof value !== "string") {
    throw badRequest(`Provide exactly one nickname for "${label}".`);
  }
  const nickname = value.trim();
  if (!NICKNAME.test(nickname)) {
    throw badRequest(
      `"${label}" must be a FACEIT nickname: 2 to 32 characters, letters, numbers, "-", "_" or ".".`
    );
  }
  return nickname;
}

/**
 * Query for nickname suggestions: the same rules as a full nickname.
 * @param {Record<string, unknown>} query
 * @returns {string}
 */
export function parseSearchQuery(query) {
  return parseNickname(query.q, "q");
}

/**
 * @param {Record<string, unknown>} query
 * @returns {{ a: string, b: string }}
 */
export function parseCompareQuery(query) {
  const a = parseNickname(query.a, "a");
  const b = parseNickname(query.b, "b");
  if (a.toLowerCase() === b.toLowerCase()) {
    throw badRequest("Pick two different players to compare.");
  }
  return { a, b };
}
