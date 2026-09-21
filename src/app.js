import express from "express";
import { comparePlayers } from "./compare.js";
import { AppError } from "./errors.js";

const DEFAULT_DEPTH = 200;
const MAX_DEPTH = 500;

export const app = express();

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    usage: `/compare?a=<nickname>&b=<nickname>&depth=<1-${MAX_DEPTH}, default ${DEFAULT_DEPTH}>`,
  });
});

app.get("/compare", async (req, res) => {
  const { a, b, depth } = req.query;

  if (typeof a !== "string" || typeof b !== "string" || !a.trim() || !b.trim()) {
    return res
      .status(400)
      .json({ error: "Provide two Faceit nicknames: ?a=player1&b=player2" });
  }
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) {
    return res.status(400).json({ error: "Pick two different players" });
  }

  let maxMatches = DEFAULT_DEPTH;
  if (depth !== undefined) {
    maxMatches = Number(depth);
    if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > MAX_DEPTH) {
      return res
        .status(400)
        .json({ error: `depth must be a whole number from 1 to ${MAX_DEPTH}` });
    }
  }

  try {
    res.json(await comparePlayers(a.trim(), b.trim(), { maxMatches }));
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Unexpected server error" });
  }
});
