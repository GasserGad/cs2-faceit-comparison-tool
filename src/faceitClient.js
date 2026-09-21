import { AppError } from "./errors.js";

const BASE_URL = "https://open.faceit.com/data/v4";
const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100; // Faceit's max page size for match history

function authHeaders() {
  const apiKey = process.env.FACEIT_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "FACEIT_API_KEY is not set. Get a free key at https://developers.faceit.com/ and put it in .env",
      500
    );
  }
  return { Authorization: `Bearer ${apiKey}` };
}

async function faceitGet(path) {
  const headers = authHeaders();

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError(`Could not reach Faceit: ${err.message}`, 502);
  }

  if (res.ok) return res.json();

  if (res.status === 404) throw new AppError("Not found on Faceit", 404);
  if (res.status === 401 || res.status === 403) {
    throw new AppError("Faceit rejected the API key. Check FACEIT_API_KEY in .env", 500);
  }
  if (res.status === 429) {
    throw new AppError("Faceit rate limit reached. Try again in a moment", 429);
  }
  throw new AppError(`Faceit API error: ${res.status} ${res.statusText}`, 502);
}

export async function getPlayerByNickname(nickname) {
  try {
    return await faceitGet(`/players?nickname=${encodeURIComponent(nickname)}`);
  } catch (err) {
    if (err.status === 404) {
      throw new AppError(
        `Player "${nickname}" not found on Faceit. Check the exact spelling`,
        404
      );
    }
    throw err;
  }
}

export async function getPlayerStats(playerId, game = "cs2") {
  try {
    return await faceitGet(`/players/${playerId}/stats/${game}`);
  } catch (err) {
    if (err.status === 404) {
      throw new AppError("That player has no CS2 stats on Faceit", 404);
    }
    throw err;
  }
}

// Newest matches first. Pages through the history until maxMatches is
// reached or Faceit has no more matches for the player.
//
// Faceit answers 400 when the offset is not a multiple of the page size, so
// every request is a full page at offsets 0, 100, 200... and the result is
// trimmed to maxMatches afterwards.
export async function getPlayerMatchHistory(playerId, game = "cs2", maxMatches = 200) {
  const matches = [];

  for (let offset = 0; matches.length < maxMatches; offset += PAGE_SIZE) {
    const data = await faceitGet(
      `/players/${playerId}/history?game=${game}&offset=${offset}&limit=${PAGE_SIZE}`
    );
    const page = data.items ?? [];
    matches.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return matches.slice(0, maxMatches);
}
