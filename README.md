# CS2 Faceit Comparison Tool

Head-to-head player comparison for Counter-Strike 2, built on the [Faceit Data API](https://developers.faceit.com/). Given two Faceit nicknames, it pulls each player's lifetime stats and cross-references match history to surface games they've played together or against each other — insight the default Faceit interface doesn't expose directly.

**Status: in progress.** Core client and comparison logic are implemented; not yet tested against live data (needs a Faceit API key) and no frontend yet.

## Setup

```
npm install
cp .env.example .env
# add your FACEIT_API_KEY from https://developers.faceit.com/
npm start
```

## Usage

```
GET /compare?a=<nickname1>&b=<nickname2>
```

Returns each player's lifetime stats plus any matches where both appear (tagged `teammates` or `opponents`).

## Architecture

- `src/faceitClient.js` — thin wrapper over the Faceit Data API (player lookup, stats, match history)
- `src/compare.js` — cross-references two players' match histories to find shared matches and classify the relationship
- `src/server.js` — Express server exposing the comparison endpoint

## Roadmap

- [ ] Get a Faceit API key and validate against live data
- [ ] Handle pagination for players with long match histories
- [ ] Frontend for entering two nicknames and viewing the comparison
- [ ] Deploy
