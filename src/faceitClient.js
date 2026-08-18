const BASE_URL = "https://open.faceit.com/data/v4";

function authHeaders() {
  const apiKey = process.env.FACEIT_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FACEIT_API_KEY is not set. Get a free key at https://developers.faceit.com/ and put it in .env"
    );
  }
  return { Authorization: `Bearer ${apiKey}` };
}

async function faceitGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Faceit API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getPlayerByNickname(nickname) {
  return faceitGet(`/players?nickname=${encodeURIComponent(nickname)}`);
}

export async function getPlayerStats(playerId, game = "cs2") {
  return faceitGet(`/players/${playerId}/stats/${game}`);
}

export async function getPlayerMatchHistory(playerId, game = "cs2", limit = 50) {
  const data = await faceitGet(
    `/players/${playerId}/history?game=${game}&limit=${limit}`
  );
  return data.items ?? [];
}
