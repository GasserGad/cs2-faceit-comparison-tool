import {
  getPlayerByNickname,
  getPlayerStats,
  getPlayerMatchHistory,
} from "./faceitClient.js";
import { AppError } from "./errors.js";

// Faceit sends stats as strings ("48", "87.08"). Convert, or null if missing.
function num(value) {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : null;
}

function factionOf(match, playerId) {
  for (const faction of ["faction1", "faction2"]) {
    if (match.teams?.[faction]?.players?.some((p) => p.player_id === playerId)) {
      return faction;
    }
  }
  return null;
}

/**
 * Matches that both players appear in, tagged "teammates" (same faction) or
 * "opponents" (different factions), newest first. winnerA is true if player
 * A's side won, false if it lost, and null if the match has no result.
 *
 * Every match lists all ten players, so a shared match only has to appear in
 * one of the two histories. Searching both means a player with a very long
 * history (whose window doesn't reach as far back) doesn't hide older matches.
 */
export function findSharedMatches(matchesA, playerAId, matchesB, playerBId) {
  const byId = new Map();
  for (const match of [...matchesA, ...matchesB]) {
    if (!byId.has(match.match_id)) byId.set(match.match_id, match);
  }

  const shared = [];

  for (const match of byId.values()) {
    const factionA = factionOf(match, playerAId);
    const factionB = factionOf(match, playerBId);
    if (!factionA || !factionB) continue; // one of them isn't in this match

    const winner = match.results?.winner;
    shared.push({
      matchId: match.match_id,
      finishedAt: match.finished_at,
      competition: match.competition_name,
      relationship: factionA === factionB ? "teammates" : "opponents",
      winnerA: winner ? winner === factionA : null,
    });
  }

  return shared.sort((x, y) => y.finishedAt - x.finishedAt);
}

/** Win/loss record for the shared matches, split by teammates and opponents. */
export function summarizeHeadToHead(shared, nicknameA, nicknameB) {
  const teammates = shared.filter((m) => m.relationship === "teammates");
  const opponents = shared.filter((m) => m.relationship === "opponents");
  const count = (list, value) => list.filter((m) => m.winnerA === value).length;

  return {
    totalShared: shared.length,
    asTeammates: {
      played: teammates.length,
      won: count(teammates, true),
      lost: count(teammates, false),
    },
    asOpponents: {
      played: opponents.length,
      wins: {
        [nicknameA]: count(opponents, true),
        [nicknameB]: count(opponents, false),
      },
    },
  };
}

function summarizePlayer(player, stats) {
  const lifetime = stats.lifetime ?? {};
  const cs2 = player.games?.cs2 ?? {};
  return {
    id: player.player_id,
    nickname: player.nickname,
    country: player.country ?? null,
    region: cs2.region ?? null,
    level: cs2.skill_level ?? null,
    elo: cs2.faceit_elo ?? null,
    matches: num(lifetime["Matches"]),
    winRate: num(lifetime["Win Rate %"]),
    avgKd: num(lifetime["Average K/D Ratio"]),
    adr: num(lifetime["ADR"]),
    headshotPct: num(lifetime["Average Headshots %"]),
  };
}

export async function comparePlayers(nicknameA, nicknameB, { maxMatches = 200 } = {}) {
  const [playerA, playerB] = await Promise.all([
    getPlayerByNickname(nicknameA),
    getPlayerByNickname(nicknameB),
  ]);

  if (playerA.player_id === playerB.player_id) {
    throw new AppError("Those nicknames are the same player. Pick two different players", 400);
  }

  const [statsA, statsB, historyA, historyB] = await Promise.all([
    getPlayerStats(playerA.player_id),
    getPlayerStats(playerB.player_id),
    getPlayerMatchHistory(playerA.player_id, "cs2", maxMatches),
    getPlayerMatchHistory(playerB.player_id, "cs2", maxMatches),
  ]);

  const shared = findSharedMatches(
    historyA,
    playerA.player_id,
    historyB,
    playerB.player_id
  );

  return {
    players: [summarizePlayer(playerA, statsA), summarizePlayer(playerB, statsB)],
    matchesChecked: { [playerA.nickname]: historyA.length, [playerB.nickname]: historyB.length },
    headToHead: summarizeHeadToHead(shared, playerA.nickname, playerB.nickname),
    sharedMatches: shared,
  };
}
