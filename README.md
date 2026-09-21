# CS2 Faceit Comparison Tool

Head-to-head player comparison for Counter-Strike 2, built on the [Faceit Data API](https://developers.faceit.com/). Give it two Faceit nicknames and it returns each player's lifetime stats plus the matches they played together or against each other, with the win/loss record for each. Faceit's own site doesn't show that.

**Status: in progress.** The API and tests work against live Faceit data. A frontend and a hosted demo are next.

## Setup

```
npm install
cp .env.example .env
# add your FACEIT_API_KEY (server-side key) from https://developers.faceit.com/
npm start
```

## Usage

```
GET /compare?a=<nickname1>&b=<nickname2>&depth=<1-500>
```

`depth` is how many recent matches to check per player (default 200, max 500). Nicknames are matched by their exact Faceit spelling; capitalization is normalized.

Example response (trimmed, made-up players):

```json
{
  "players": [
    { "nickname": "Alice", "country": "us", "region": "NA", "level": 6, "elo": 1243,
      "matches": 430, "winRate": 48, "avgKd": 1.19, "adr": 87.08, "headshotPct": 63 },
    { "nickname": "Bob", "country": "us", "region": "NA", "level": 5, "elo": 1172,
      "matches": 595, "winRate": 50, "avgKd": 1.15, "adr": 81.57, "headshotPct": 43 }
  ],
  "matchesChecked": { "Alice": 200, "Bob": 175 },
  "headToHead": {
    "totalShared": 113,
    "asTeammates": { "played": 113, "won": 57, "lost": 56 },
    "asOpponents": { "played": 0, "wins": { "Alice": 0, "Bob": 0 } }
  },
  "sharedMatches": [
    { "matchId": "1-...", "finishedAt": 1774575013, "competition": "North America 5V5 Queue",
      "relationship": "teammates", "winnerA": false }
  ]
}
```

`winnerA` is `true` if the first player's side won that match.

### Errors

| Status | Meaning |
|--------|---------|
| 400 | Missing nickname, the same player twice, or an invalid `depth` |
| 404 | A nickname doesn't exist on Faceit, or the player has no CS2 stats |
| 429 | Faceit rate limit reached, try again shortly |
| 500 | `FACEIT_API_KEY` missing or rejected |
| 502 | Faceit is unreachable or returned an unexpected error |

## Architecture

- `src/faceitClient.js` — wrapper over the Faceit Data API: player lookup, stats, paged match history, timeouts and error mapping
- `src/compare.js` — finds shared matches, classifies them as teammates or opponents, and builds the win/loss record
- `src/app.js` — Express app and request validation
- `src/server.js` — starts the server

## Tests

```
npm test
```

Runs on Node's built-in test runner with mocked Faceit responses, so it needs no API key or network access.

## Known limits

- Faceit's history endpoint only returns part of some players' older matches, so `matchesChecked` can be lower than `depth`.
- A shared match is found if it falls inside either player's checked window (every match lists all ten players), so a player with a very long history doesn't hide older matches. Matches older than both windows won't be found; raise `depth` to reach further.
- Faceit rejects history requests whose offset isn't a multiple of the page size, so the client always requests full pages of 100 and trims.

## Roadmap

- [x] Validate against live Faceit data
- [x] Paginate long match histories
- [x] Head-to-head win/loss record
- [x] Automated tests
- [ ] Frontend for entering two nicknames and viewing the comparison
- [ ] CI that runs the tests on GitHub
- [ ] Deploy
