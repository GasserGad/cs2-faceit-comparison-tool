# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-16

### Added

- Nickname suggestions while typing in either player box: up to six matching CS2 players with avatar, level and country. Works with the mouse or keyboard (arrow keys, Enter, Escape) and follows the ARIA combobox pattern for screen readers.
- `GET /api/search?q=<partial nickname>` endpoint backed by the FACEIT player search, with its own per-IP rate limit (`SEARCH_RATE_LIMIT_PER_MINUTE`, default 60) and a 10-minute server-side cache per prefix.
- Results are re-ranked (exact match, then prefix, then contains), players without a CS2 level are dropped, and only whitelisted fields are returned.
- 20 new tests (74 total) covering ranking, validation, caching, rate limiting, avatar filtering and upstream failures.

### Changed

- Content Security Policy now allows images from FACEIT's avatar CDN (`assets.faceit-cdn.net`, `distribution.faceit-cdn.net`) and nothing else new.
- `Cross-Origin-Embedder-Policy` is now `credentialless` so those avatars can load without cookies.
- Privacy Policy explains that partial nicknames go to FACEIT's search and that avatars load from FACEIT's image servers.

## [1.0.0] - 2026-10-15

- First public release: head-to-head comparison of two FACEIT CS2 players, shared-match finder, rate limiting, strict CSP, CI with CodeQL and secret scanning.
