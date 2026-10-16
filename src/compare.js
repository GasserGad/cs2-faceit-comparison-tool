import { playerNotFound } from "./errors.js";

// Lifetime stats we show. Only whitelisted fields leave the server, so the
// response never carries unexpected upstream data.
const STAT_FIELDS = /** @type {const} */ ({
  matches: "Matches",
  winRatePercent: "Win Rate %",
  kdRatio: "Average K/D Ratio",
  headshotPercent: "Average Headshots %",
  longestWinStreak: "Longest Win Streak",
});

/**
 * @param {import("./faceitClient.js").FaceitHistoryItem} match
 * @param {string} playerId
 * @returns {string | null} faction key (e.g. "faction1") or null if absent
 */
export function findFaction(match, playerId) {
  const teams = match.teams ?? {};
  for (const [faction, team] of Object.entries(teams)) {
    if (team?.players?.some((p) => p.player_id === playerId)) return faction;
  }
  return null;
}

/**
 * Matches both players appear in, labeled teammates or opponents, with the
 * result from player A's point of view.
 * @param {import("./faceitClient.js").FaceitHistoryItem[]} historyA
 * @param {string} playerAId
 * @param {import("./faceitClient.js").FaceitHistoryItem[]} historyB
 * @param {string} playerBId
 */
export function findSharedMatches(historyA, playerAId, historyB, playerBId) {
  const idsInB = new Set(historyB.map((m) => m.match_id));
  const seen = new Set();
  const shared = [];

  for (const match of historyA) {
    if (!idsInB.has(match.match_id) || seen.has(match.match_id)) continue;
    seen.add(match.match_id);

    const factionA = findFaction(match, playerAId);
    const factionB = findFaction(match, playerBId);
    if (!factionA || !factionB) continue; // roster missing: don't guess

    const winner = match.results?.winner;
    shared.push({
      matchId: match.match_id,
      finishedAt: typeof match.finished_at === "number" ? new Date(match.finished_at * 1000).toISOString() : null,
      competition: typeof match.competition_name === "string" ? match.competition_name : null,
      relationship: factionA === factionB ? "teammates" : "opponents",
      playerAWon: typeof winner === "string" ? winner === factionA : null,
    });
  }

  shared.sort((x, y) => (y.finishedAt ?? "").localeCompare(x.finishedAt ?? ""));
  return shared;
}

/** @param {ReturnType<typeof findSharedMatches>} shared */
export function summarize(shared) {
  const together = shared.filter((m) => m.relationship === "teammates");
  const against = shared.filter((m) => m.relationship === "opponents");
  return {
    totalShared: shared.length,
    teammates: {
      played: together.length,
      won: together.filter((m) => m.playerAWon === true).length,
    },
    opponents: {
      played: against.length,
      playerAWins: against.filter((m) => m.playerAWon === true).length,
      playerBWins: against.filter((m) => m.playerAWon === false).length,
    },
  };
}

/** @param {any} stats */
function pickStats(stats) {
  const lifetime = stats?.lifetime ?? {};
  /** @type {Record<string, string | number | null>} */
  const picked = {};
  for (const [key, field] of Object.entries(STAT_FIELDS)) {
    // Safe: `key` and `field` come from the constant whitelist above, never from input.
    // eslint-disable-next-line security/detect-object-injection
    const value = Object.hasOwn(lifetime, field) ? lifetime[field] : null;
    // eslint-disable-next-line security/detect-object-injection
    picked[key] = typeof value === "string" || typeof value === "number" ? value : null;
  }
  return picked;
}

/** @param {import("./faceitClient.js").FaceitPlayer} player @param {any} stats */
function publicPlayer(player, stats) {
  const cs2 = player.games?.cs2 ?? {};
  return {
    id: player.player_id,
    nickname: player.nickname,
    elo: typeof cs2.faceit_elo === "number" ? cs2.faceit_elo : null,
    skillLevel: typeof cs2.skill_level === "number" ? cs2.skill_level : null,
    stats: pickStats(stats),
  };
}

/**
 * @param {{ faceit: import("./faceitClient.js").FaceitClient, maxMatchesPerPlayer: number }} deps
 */
export function createCompareService({ faceit, maxMatchesPerPlayer }) {
  return {
    /** @param {string} nicknameA @param {string} nicknameB */
    async compare(nicknameA, nicknameB) {
      const [playerA, playerB] = await Promise.all([
        faceit.getPlayerByNickname(nicknameA),
        faceit.getPlayerByNickname(nicknameB),
      ]);
      if (!playerA) throw playerNotFound(nicknameA);
      if (!playerB) throw playerNotFound(nicknameB);

      const [statsA, statsB, historyA, historyB] = await Promise.all([
        faceit.getPlayerStats(playerA.player_id),
        faceit.getPlayerStats(playerB.player_id),
        faceit.getPlayerMatchHistory(playerA.player_id, maxMatchesPerPlayer),
        faceit.getPlayerMatchHistory(playerB.player_id, maxMatchesPerPlayer),
      ]);

      const sharedMatches = findSharedMatches(historyA, playerA.player_id, historyB, playerB.player_id);
      return {
        playerA: publicPlayer(playerA, statsA),
        playerB: publicPlayer(playerB, statsB),
        matchesScanned: { playerA: historyA.length, playerB: historyB.length },
        summary: summarize(sharedMatches),
        sharedMatches,
      };
    },
  };
}
