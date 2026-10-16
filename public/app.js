// Front-end for the comparison page.
// Security note: every value from the API is inserted with textContent or
// validated before use in an href. No innerHTML, so player names or other
// upstream data can never inject markup or scripts (XSS).

const NICKNAME = /^[A-Za-z0-9_.-]{2,32}$/;
const MATCH_ID = /^[A-Za-z0-9-]{8,64}$/;

const form = /** @type {HTMLFormElement} */ (document.getElementById("compare-form"));
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

/**
 * @param {string} tag
 * @param {string} [text]
 * @param {string} [className]
 */
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** @param {string} message @param {boolean} [isError] */
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

/** @param {unknown} value */
const show = (value) => (value === null || value === undefined || value === "" ? "–" : String(value));

/** @param {HTMLElement} container @param {any} player @param {string} label */
function renderPlayer(container, player, label) {
  container.replaceChildren();
  container.append(el("p", label, "label"), el("h2", player.nickname));
  const meta = el("p", `Level ${show(player.skillLevel)} · ${show(player.elo)} Elo`, "meta");
  container.append(meta);

  const list = el("dl");
  const rows = [
    ["Matches", player.stats.matches],
    ["Win rate", player.stats.winRatePercent == null ? null : `${player.stats.winRatePercent}%`],
    ["K/D", player.stats.kdRatio],
    ["Headshots", player.stats.headshotPercent == null ? null : `${player.stats.headshotPercent}%`],
    ["Longest win streak", player.stats.longestWinStreak],
  ];
  for (const [name, value] of rows) {
    list.append(el("dt", name), el("dd", show(value)));
  }
  container.append(list);
}

/** @param {any} data */
function renderSummary(data) {
  const box = document.getElementById("summary");
  box.replaceChildren();
  const { summary, playerA, playerB } = data;
  const items = [
    ["Shared matches", String(summary.totalShared)],
    ["As teammates", `${summary.teammates.played} played, ${summary.teammates.won} won`],
    ["Head to head", `${playerA.nickname} ${summary.opponents.playerAWins} – ${summary.opponents.playerBWins} ${playerB.nickname}`],
  ];
  for (const [label, value] of items) {
    const card = el("div", undefined, "stat");
    card.append(el("span", label, "label"), el("strong", value));
    box.append(card);
  }
}

/** @param {any} data */
function renderMatches(data) {
  document.getElementById("scanned").textContent =
    `Scanned the last ${data.matchesScanned.playerA} matches of ${data.playerA.nickname} and ${data.matchesScanned.playerB} of ${data.playerB.nickname}.`;

  const tbody = document.getElementById("match-rows");
  tbody.replaceChildren();
  if (data.sharedMatches.length === 0) {
    const row = el("tr");
    const cell = el("td", "No shared matches in the scanned history.");
    cell.colSpan = 5;
    row.append(cell);
    tbody.append(row);
    return;
  }

  for (const match of data.sharedMatches) {
    const row = el("tr");
    const date = match.finishedAt ? new Date(match.finishedAt).toLocaleDateString() : "–";
    const result = match.playerAWon === null ? "–" : match.playerAWon ? "Won" : "Lost";
    row.append(
      el("td", date),
      el("td", match.relationship === "teammates" ? "Teammates" : "Opponents"),
      el("td", result, match.playerAWon ? "win" : match.playerAWon === false ? "loss" : ""),
      el("td", show(match.competition))
    );

    const linkCell = el("td");
    if (typeof match.matchId === "string" && MATCH_ID.test(match.matchId)) {
      const link = /** @type {HTMLAnchorElement} */ (el("a", "Open"));
      link.href = `https://www.faceit.com/en/cs2/room/${encodeURIComponent(match.matchId)}`;
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      linkCell.append(link);
    }
    row.append(linkCell);
    tbody.append(row);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const a = String(data.get("a") ?? "").trim();
  const b = String(data.get("b") ?? "").trim();

  if (!NICKNAME.test(a) || !NICKNAME.test(b)) {
    setStatus("Nicknames are 2 to 32 characters: letters, numbers, - _ or .", true);
    return;
  }
  if (a.toLowerCase() === b.toLowerCase()) {
    setStatus("Pick two different players.", true);
    return;
  }

  const button = form.querySelector("button");
  button.disabled = true;
  resultsEl.hidden = true;
  setStatus("Loading match histories…");

  try {
    const params = new URLSearchParams({ a, b });
    const res = await fetch(`/api/compare?${params}`, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(body?.error?.message ?? "Something went wrong. Please try again.", true);
      return;
    }
    renderPlayer(document.getElementById("player-a"), body.playerA, "Player A");
    renderPlayer(document.getElementById("player-b"), body.playerB, "Player B");
    renderSummary(body);
    renderMatches(body);
    resultsEl.hidden = false;
    setStatus("");
  } catch {
    setStatus("Network error. Check your connection and try again.", true);
  } finally {
    button.disabled = false;
  }
});
