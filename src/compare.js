import {
  getPlayerByNickname,
  getPlayerStats,
  getPlayerMatchHistory,
} from "./faceitClient.js";

/**
 * Find matches where both players appear together, and split them into
 * "played together" (same team) vs "played against" (opposite teams) using
 * each match's faction rosters.
 */
function findSharedMatches(matchesA, playerAId, matchesB, playerBId) {
  const matchIdsB = new Map(matchesB.map((m) => [m.match_id, m]));
  const shared = [];

  for (const matchA of matchesA) {
    const matchB = matchIdsB.get(matchA.match_id);
    if (!matchB) continue;

    const factionA = matchA.teams?.faction1?.players?.some(
      (p) => p.player_id === playerAId
    )
      ? "faction1"
      : "faction2";
    const factionB = matchA.teams?.faction1?.players?.some(
      (p) => p.player_id === playerBId
    )
      ? "faction1"
      : "faction2";

    shared.push({
      matchId: matchA.match_id,
      finishedAt: matchA.finished_at,
      relationship: factionA === factionB ? "teammates" : "opponents",
      competition: matchA.competition_name,
    });
  }

  return shared;
}

export async function comparePlayers(nicknameA, nicknameB) {
  const [playerA, playerB] = await Promise.all([
    getPlayerByNickname(nicknameA),
    getPlayerByNickname(nicknameB),
  ]);

  const [statsA, statsB, historyA, historyB] = await Promise.all([
    getPlayerStats(playerA.player_id),
    getPlayerStats(playerB.player_id),
    getPlayerMatchHistory(playerA.player_id),
    getPlayerMatchHistory(playerB.player_id),
  ]);

  const sharedMatches = findSharedMatches(
    historyA,
    playerA.player_id,
    historyB,
    playerB.player_id
  );

  return {
    players: {
      [nicknameA]: { id: playerA.player_id, stats: statsA.lifetime },
      [nicknameB]: { id: playerB.player_id, stats: statsB.lifetime },
    },
    sharedMatches,
  };
}
