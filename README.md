# CS2 H2H

Compare two FACEIT Counter-Strike 2 players and see every recent match they played **together** or **against each other**, with win/loss records. FACEIT's own site doesn't show this.

Node.js · Express 5 · FACEIT Data API · zero-dependency front-end

![CI](https://github.com/GasserGad/cs2-faceit-comparison-tool/actions/workflows/ci.yml/badge.svg)

## Features

- Lifetime stats side by side: Elo, level, K/D, win rate, headshot %
- Shared-match finder across each player's recent history (200 matches each by default, paged from the API)
- Teammate record and head-to-head record
- Plain, fast UI with links to each FACEIT match room
- Terms of Use and Privacy Policy pages

## How it works

```
Browser ──► Express app ──► FACEIT Data API
             │
             ├─ validation (allow-list)       src/validation.js
             ├─ rate limits (per IP)          src/app.js
             ├─ comparison logic              src/compare.js
             ├─ FACEIT client                 src/faceitClient.js
             │    ├─ timeouts + one retry on 429/5xx
             │    ├─ concurrency limiter      src/limiter.js
             │    └─ bounded TTL cache        src/cache.js
             └─ central error handler (no internal details leak)
```

A comparison looks up both players, then fetches their stats and match histories in parallel. Matches are joined by ID, and each player's team ("faction") is read from the match roster to label them teammates or opponents. Matches with an incomplete roster are skipped rather than guessed.

## Run it locally

Requires Node.js 22+ and a free **server-side** API key from the [FACEIT Developer Portal](https://developers.faceit.com/).

```bash
npm install
cp .env.example .env      # then put your FACEIT_API_KEY in .env
npm run dev               # http://localhost:3000
```

API: `GET /api/compare?a=<nickname>&b=<nickname>` · Health: `GET /healthz`

## Tests and checks

```bash
npm test            # 54 tests, FACEIT API mocked (no key or network needed)
npm run lint        # ESLint + security plugin + XSS rules for the front-end
npm run typecheck   # TypeScript checks the JSDoc-typed source
npm run check       # all of the above
```

CI runs these on Node 22 and 24, plus `npm audit`, a gitleaks secret scan and CodeQL. Dependabot keeps dependencies current.

## Security

See [SECURITY.md](SECURITY.md) for the full threat table and how to report a vulnerability. Highlights:

- Strict input validation; arrays, nested objects and odd characters are rejected before anything else runs
- No `innerHTML` anywhere (lint-enforced) plus a strict Content Security Policy, so upstream data can't inject scripts
- Errors return safe messages only; details go to server logs
- The API key lives only in environment variables and is never sent to the browser

## Abuse and DDoS protection

Layers inside the app:

1. **Per-IP rate limits:** 120 requests/minute site-wide, 10 comparisons/minute
2. **Load shedding:** at most 4 FACEIT calls run at once, 100 may wait, and the rest get an immediate `503` with `Retry-After` instead of piling up
3. **Caching:** repeat lookups don't hit FACEIT, which protects the API key's quota
4. **Timeouts:** 10 s for headers, 30 s per request, 8 s per FACEIT call (blunts slowloris-style attacks)
5. **Small attack surface:** GET-only, URL length capped, no request bodies, no database

What the app **cannot** do alone: absorb a large network flood. That has to be stopped before traffic reaches the server. On Render's free tier, traffic goes through Render's own edge network. For stronger protection, put a custom domain behind **Cloudflare's free plan**, which proxies traffic, absorbs volumetric attacks and lets you add WAF and rate-limit rules. A domain costs about $10/year.

## Deploy (free) on Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick this repo. `render.yaml` sets everything up.
3. Add `FACEIT_API_KEY` in the service's **Environment** settings.
4. After deploy, open the URL and run a comparison between two players you know have played together.

Free Render services sleep after inactivity, so the first request after a while takes a few seconds.

Docker is also supported: `docker build -t cs2-h2h . && docker run -p 3000:3000 -e FACEIT_API_KEY=... cs2-h2h`

## Configuration

All settings are environment variables; see [.env.example](.env.example). Invalid values stop the server at startup with a clear message.

## License

MIT. Not affiliated with or endorsed by FACEIT or Valve.
