# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Do not open a public issue for security problems.

Include what you found, how to reproduce it, and the impact you expect. You can expect a first reply within 7 days. Please give a reasonable time to fix the issue before disclosing it publicly.

Testing that degrades the live service for other users (load testing, flooding, automated scanning at volume) is not allowed.

## Security measures in this project

| Threat | Mitigation |
| --- | --- |
| Injection and malformed input | Strict allow-list validation of every query parameter; arrays and nested objects rejected; upstream IDs validated before use in URLs |
| Cross-site scripting (XSS) | Front-end uses `textContent` only (enforced by lint rule); strict Content Security Policy with no inline scripts or styles |
| Clickjacking | `frame-ancestors 'none'` |
| Information leakage | Generic error messages; stack traces and upstream details only in server logs; `X-Powered-By` removed; only whitelisted stat fields returned |
| API key exposure | Key only in environment variables; `.env` git-ignored; gitleaks scan in CI |
| Abuse and denial of service | Per-IP rate limits (site-wide and per endpoint); bounded upstream concurrency with load shedding; bounded caches; request, header and upstream timeouts; URL length limit; GET-only API |
| IP spoofing to dodge limits | Proxy headers trusted only for a configured number of hops |
| Vulnerable dependencies | `npm audit` and CodeQL in CI; Dependabot updates |
| Container escape impact | Docker image runs as the non-root `node` user |
