import "dotenv/config";
import express from "express";
import { comparePlayers } from "./compare.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    usage: "/compare?a=<nickname>&b=<nickname>",
  });
});

app.get("/compare", async (req, res) => {
  const { a, b } = req.query;
  if (!a || !b) {
    return res
      .status(400)
      .json({ error: "Provide two Faceit nicknames: ?a=player1&b=player2" });
  }

  try {
    const result = await comparePlayers(a, b);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`CS2 Faceit Comparison Tool listening on http://localhost:${PORT}`);
});
