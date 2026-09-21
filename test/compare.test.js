import { test } from "node:test";
import assert from "node:assert/strict";
import { findSharedMatches, summarizeHeadToHead } from "../src/compare.js";

// Builds a match like the Faceit history API returns it.
function match(id, faction1, faction2, winner) {
  return {
    match_id: id,
    finished_at: 1700000000,
    competition_name: "5v5 Queue",
    teams: {
      faction1: { players: faction1.map((player_id) => ({ player_id })) },
      faction2: { players: faction2.map((player_id) => ({ player_id })) },
    },
    results: winner ? { winner } : undefined,
  };
}

test("tags a match as teammates when both players share a faction", () => {
  const history = [match("m1", ["A", "B", "x"], ["y", "z", "w"], "faction1")];
  const shared = findSharedMatches(history, "A", history, "B");

  assert.equal(shared.length, 1);
  assert.equal(shared[0].relationship, "teammates");
  assert.equal(shared[0].winnerA, true);
});

test("tags a match as opponents when players are on different factions", () => {
  const history = [match("m2", ["A", "x"], ["B", "y"], "faction2")];
  const shared = findSharedMatches(history, "A", history, "B");

  assert.equal(shared[0].relationship, "opponents");
  assert.equal(shared[0].winnerA, false); // B's side won
});

test("ignores matches where the other player is not in the roster", () => {
  const historyA = [match("m1", ["A"], ["x"], "faction1"), match("m2", ["A"], ["B"], "faction1")];
  const historyB = [match("m2", ["A"], ["B"], "faction1")];
  const shared = findSharedMatches(historyA, "A", historyB, "B");

  assert.deepEqual(shared.map((m) => m.matchId), ["m2"]);
});

test("finds a shared match even when it is only in one player's history", () => {
  // e.g. B has played so many games that their window doesn't reach this match
  const old = match("old", ["A", "x"], ["B", "y"], "faction1");
  const shared = findSharedMatches([old], "A", [], "B");

  assert.equal(shared.length, 1);
  assert.equal(shared[0].relationship, "opponents");
  assert.equal(shared[0].winnerA, true);
});

test("a match in both histories is counted once", () => {
  const both = match("m1", ["A", "B"], ["x", "y"], "faction1");
  assert.equal(findSharedMatches([both], "A", [both], "B").length, 1);
});

test("shared matches are sorted newest first", () => {
  const older = { ...match("old", ["A", "B"], ["x"], "faction1"), finished_at: 100 };
  const newer = { ...match("new", ["A", "B"], ["x"], "faction1"), finished_at: 200 };
  const shared = findSharedMatches([older], "A", [newer], "B");

  assert.deepEqual(shared.map((m) => m.matchId), ["new", "old"]);
});

test("skips a match when a roster does not include both players", () => {
  const history = [match("m1", ["A", "x"], ["y", "z"], "faction1")]; // B missing
  assert.equal(findSharedMatches(history, "A", history, "B").length, 0);
});

test("winnerA is null when the match has no result", () => {
  const history = [match("m1", ["A", "B"], ["x", "y"], undefined)];
  assert.equal(findSharedMatches(history, "A", history, "B")[0].winnerA, null);
});

test("summarizes teammate and opponent records", () => {
  const shared = [
    { relationship: "teammates", winnerA: true },
    { relationship: "teammates", winnerA: false },
    { relationship: "teammates", winnerA: true },
    { relationship: "opponents", winnerA: true },
    { relationship: "opponents", winnerA: false },
    { relationship: "opponents", winnerA: false },
    { relationship: "opponents", winnerA: null }, // no result: played, not counted as a win
  ];
  const summary = summarizeHeadToHead(shared, "Alice", "Bob");

  assert.equal(summary.totalShared, 7);
  assert.deepEqual(summary.asTeammates, { played: 3, won: 2, lost: 1 });
  assert.deepEqual(summary.asOpponents, {
    played: 4,
    wins: { Alice: 1, Bob: 2 },
  });
});

test("summary of no shared matches is all zeros", () => {
  const summary = summarizeHeadToHead([], "Alice", "Bob");
  assert.equal(summary.totalShared, 0);
  assert.deepEqual(summary.asTeammates, { played: 0, won: 0, lost: 0 });
  assert.deepEqual(summary.asOpponents.wins, { Alice: 0, Bob: 0 });
});
