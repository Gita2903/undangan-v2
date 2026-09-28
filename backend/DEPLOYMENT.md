# Production Deployment

Target origin: `https://wedding-gita-rendra.cungz.site/`.

The server loads environment variables from `backend/.env`. Keep this file outside version control and never copy it into `public/`.

## Production

- Set `NODE_ENV=production` and a unique `JWT_SECRET` with at least 32 characters.
- To enable door-staff login, set a separate `CHECKIN_USERNAME` (at least 3 characters) and `CHECKIN_PASSWORD` (at least 12 characters). These credentials only issue check-in tokens and cannot access admin endpoints; if unset, check-in login returns a configuration error while the rest of the application remains available.
- Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters), and `ADMIN_ACCESS_KEY` (at least 32 characters). On first run, these seed a new database. If an existing database still has the demo credentials, startup rotates the existing admin row from these values once, preserving its comments and related records.
- Change the invitation page's `data-key` value in `index.html` to the same value as `ADMIN_ACCESS_KEY`. The key is the guest-facing API credential and is intentionally present in the published page; rotate it from the dashboard if it is exposed, then update the page value.
- Set `CORS_ORIGINS` to comma-separated, exact browser origins, including scheme and port where applicable. Same-origin hosting does not require a CORS entry.
- Set `TRUST_PROXY_HOPS` only when behind a trusted reverse proxy. Use the number of proxy hops between the internet and this application.
- Serve the site and API over HTTPS in production.
- Keep `PORT=3000` for the Node service behind the hosting reverse proxy. Set `TRUST_PROXY_HOPS=1` only if exactly one trusted proxy forwards requests to Node; otherwise leave it unset or use the actual trusted proxy hop count.

The frontend and API use the same origin, so leave `data-url` unset/empty and keep `CORS_ORIGINS=https://wedding-gita-rendra.cungz.site`. Same-origin requests do not require CORS, but this exact allowlist is retained for the browser API policy. If a separate API subdomain is introduced later, set its base URL on `<body>` for each HTML page and add only the invitation-site origin to `CORS_ORIGINS`.

The admin guest manager is available at `/guests.html`; door staff use `/checkin.html`. For a separate API origin, set the same `data-url` API base on each page. Camera access requires HTTPS or localhost.

## Build and run

1. Install dependencies in the repository root and `backend` (`npm install` in each directory).
2. Build the static deployment directory with `npm run build:production` from the repository root. Express serves only `public/`; source files, `.env`, and SQLite are not part of that document root.
3. Run `npm run start:production` from the repository root under a process manager. Keep `backend/undangan.db` on persistent storage and back it up securely.
4. Configure the hosting proxy to terminate TLS for `wedding-gita-rendra.cungz.site` and forward requests to Node on port 3000. DNS must point the domain at that host; these DNS/TLS/proxy changes are outside this repository and have not been applied here.
5. Confirm the proxy serves `/`, `/dashboard.html`, `/guests.html`, `/checkin.html`, and forwards `/api/*` to Node. Verify `/backend/.env` and `/backend/undangan.db` return 404.

For local Laragon/Apache, the frontend may instead set `data-url="http://localhost:3000/"` in its HTML and the API `CORS_ORIGINS` must include the exact local page origin. Do not use this development URL on the production domain.

## Tests

Run `npm test` from `backend`. The API suite creates a temporary SQLite database under the operating system's temp directory and deletes it after the run; it does not use `undangan.db`.