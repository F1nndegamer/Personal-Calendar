# Production deployment

This project ships:
1. A React/Vite single-page app (built to `dist/`).
2. A small Node.js HTTP server (`server/server.ts`) that proxies the
   private Magister iCalendar feed over `/ics`.

The proxy enforces the same host allowlist as the browser-side
webcal.ts — only HTTPS requests to `calendar.magister.net` are
permitted, and only under `/api/icalendar/feeds/...`. It is **not**
an open proxy.

The Magister feed URL is treated as a secret: it is supplied at
runtime via environment variables, never committed, and never logged.

## 1. Build the frontend

```bash
npm install
npm run build          # outputs frontend to dist/
npm run build:server   # outputs server to dist-server/
```

This produces two artefacts:
- `dist/` — the static frontend (`index.html`, `assets/`)
- `dist-server/server.js` — the proxy entrypoint

## 2. Copy artefacts to the Pi

The Pi pulls updates itself from GitHub via the
`personal-calendar-update` systemd timer (see §8). Manual deploys are
only needed for first-time setup or emergencies:

```bash
# On the development machine
rsync -avz dist/             pi:/var/www/calendar/
rsync -avz dist-server/      pi:/opt/personal-calendar-proxy/
rsync -avz package.json      pi:/opt/personal-calendar-proxy/
rsync -avz package-lock.json pi:/opt/personal-calendar-proxy/
```

The Pi only needs the runtime Node deps:
```bash
# On the Pi
cd /opt/personal-calendar-proxy
npm ci --omit=dev
```

## 3. Configure the proxy

The proxy reads the same configuration the Vite app does. The
production `.env` lives at `/opt/personal-calendar-proxy/.env`
(separate from the Vite `.env.local`).

```
MAGISTER_FEED_URL=webcal://calendar.magister.net/api/icalendar/feeds/YOUR-FEED-ID
HOST=127.0.0.1
PORT=3000

# Google Calendar OAuth (see §9) — never commit real values.
GOOGLE_CLIENT_ID=YOUR-CLIENT-ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR-CLIENT-SECRET
GOOGLE_REDIRECT_URI=https://calendar.f1nn.me/api/google/callback
```

> **Never commit `MAGISTER_FEED_URL`** — it contains a private feed
> identifier. Use a local `.env` with `chmod 600` permissions.

For the frontend, the build reads `.env.local`:
```
VITE_MAGISTER_FEED_URL=webcal://calendar.magister.net/api/icalendar/feeds/YOUR-FEED-ID
VITE_SCHEDULE_PROXY_URL=/ics
```

The frontend uses the same-origin path `/ics` so the proxy and the
Nginx-served frontend share an origin (no CORS).

## 4. Install the systemd service

`/etc/systemd/system/personal-calendar-proxy.service`:

```ini
[Unit]
Description=Personal Calendar iCalendar proxy
After=network.target

[Service]
Type=simple
User=finn
Group=finn
WorkingDirectory=/opt/personal-calendar-proxy
EnvironmentFile=/opt/personal-calendar-proxy/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/personal-calendar-proxy
# Only listen on loopback
IPAddressAllow=127.0.0.1
IPAddressDeny=any

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now personal-calendar-proxy
sudo systemctl status personal-calendar-proxy
```

The proxy logs only the listen address — never the feed URL.

## 5. Nginx configuration

`/etc/nginx/sites-available/calendar`:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name calendar.f1nn.me;

    root /var/www/calendar;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ics {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

The same-origin setup means the browser does not need CORS — Nginx
serves both the static files and the proxied feed from the same
host.

## 6. Test the deployment

After Nginx is reloaded and the proxy is running, verify the
end-to-end flow from the Pi:

```bash
# 1. The proxy responds (with 400, since we didn't pass a url):
curl -i http://127.0.0.1:3000/ics

# 2. Nginx proxies /ics correctly:
curl -i http://calendar.f1nn.me/ics

# 3. The full chain through the public hostname:
#    (replace the URL with your real feed)
curl -i "https://calendar.f1nn.me/ics?url=https%3A%2F%2Fcalendar.magister.net%2Fapi%2Ficalendar%2Ffeeds%2FYOUR-FEED-ID"
```

A successful response looks like:
```
HTTP/1.1 200 OK
Content-Type: text/calendar; charset=utf-8
Cache-Control: no-store

BEGIN:VCALENDAR
…
```

## 7. Automatic updates from GitHub (systemd timer)

The Pi polls GitHub every 5 minutes and rebuilds itself when `main`
moves. Two units are involved:

- `personal-calendar-update.service` (oneshot) — runs
  `/usr/local/bin/update-personal-calendar`
- `personal-calendar-update.timer` — `OnBootSec=2min`,
  `OnUnitActiveSec=5min`

The update script keeps its state in
`~/.personal-calendar-deployed-commit`: the commit hash of the build
currently served from `/var/www/calendar`. On each run it fetches
`origin/main` and compares against the **last deployed** commit — not
against the local checkout — so the service is self-healing: a checkout
that advanced without a successful deploy will still be deployed on the
next run instead of being skipped forever.

The script needs a `WorkingDirectory` (via a drop-in at
`/etc/systemd/system/personal-calendar-update.service.d/workdir.conf`),
because the base unit has none and `git` would otherwise fail with
`fatal: not a git repository`:

```ini
[Service]
WorkingDirectory=/home/finn/personal-calendar
```

Debugging a stuck deploy:

```bash
# journal of recent runs (exit 128 + "not a git repository" = workdir issue)
journalctl -u personal-calendar-update.service --since "1 hour ago"
# what is deployed vs what is checked out
cat ~/.personal-calendar-deployed-commit
cd ~/personal-calendar && git rev-parse HEAD origin/main
# what is actually served
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /var/www/calendar/index.html
```

## 8. Security notes
- The proxy is bound to `127.0.0.1:3000` only — it is **not**
  reachable from the public internet directly. Only Nginx on the
  same host can call it.
- Nginx is the only public surface. The Cloudflare Tunnel in front
  of it terminates TLS and hides the origin.
- The Magister feed URL is never:
  - committed to source control
  - written to log files
  - returned in any error response
  - exposed via the frontend bundle (only the `/ics` proxy path is
    referenced)
- The proxy only fetches `calendar.magister.net` over HTTPS — even
  if a request is forged, an arbitrary host or path is rejected with
  HTTP 400 before any upstream connection is opened.
- The whole API can sit behind one password — see §10. It is off until
  `APP_PASSWORD` is set, and the password is only ever compared on the
  Pi, never sent to a browser.

## 9. Google Calendar OAuth setup

The Node server exposes `/api/google/*` routes (status, login, callback,
logout, selection, events, push, push-target). Nothing is enabled until
three environment variables are present — without them `/api/google/status`
answers `{"connected": false, "error": "…not configured…"}` and Settings
simply shows Google as unavailable.

### 9.1 Google Cloud Console

1. Create a project at <https://console.cloud.google.com/> and
   **enable the Google Calendar API** (APIs & Services → Library).
2. Configure the **OAuth consent screen** (APIs & Services → OAuth
   consent screen): User type **External**, fill in name/email, and add
   your own Google account under **Test users** (the app stays in
   "Testing" — no verification needed for personal use).
3. **Create credentials → OAuth client ID → Web application** and add
   the authorized redirect URI (exact match, no trailing slash):
   - production: `https://calendar.f1nn.me/api/google/callback`
   - development: `http://localhost:5173/api/google/callback`
4. Copy the generated **client ID** and **client secret**.

The app requests the least-privilege scopes `calendar.readonly`,
`calendar.events`, `openid`, `email` (see `GOOGLE_SCOPES` in
`server/googleTypes.ts`).

### 9.2 Server environment

Add to `/opt/personal-calendar-proxy/.env` (see §3) and restart the
service (`sudo systemctl restart personal-calendar-proxy`):

```
GOOGLE_CLIENT_ID=….apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
GOOGLE_REDIRECT_URI=https://calendar.f1nn.me/api/google/callback
```

Tokens are written to a separate `google-auth.json` next to the main
storage file (`GOOGLE_AUTH_PATH` overrides the location) with `0600`
permissions — they never appear in logs, in `GET /api/storage`, or in
any response besides `/api/google/status`'s non-secret fields.

### 9.3 Nginx

The `/api/` location block from §5 must be live — Google routes are
ordinary same-origin API calls, so without the proxy the frontend would
receive `index.html` instead of JSON.

### 9.4 Verify

```bash
# JSON — "not configured" only before the env vars are set:
curl -i https://calendar.f1nn.me/api/google/status

# then in the app: Settings → Google Calendar → Connect.
# After consent you land on /?google=connected (Settings opens with a
# toast), tick the calendars to import, and the next sync includes them.
curl -i https://calendar.f1nn.me/api/google/status   # connected: true + email
```

Local development uses the same flow against a locally running server:
`npm run build:server`, export the three vars with
`GOOGLE_REDIRECT_URI=http://localhost:5173/api/google/callback` and a
writable `STORAGE_PATH`/`GOOGLE_AUTH_PATH`, then
`node dist-server/server.js`. The Vite dev server proxies
`/api/google` to `127.0.0.1:3000` (see `vite.config.ts`).

### 9.5 Push (app → Google Calendar)

Sync is bidirectional: after a successful import, the browser mirrors the
full local event set (manual + Magister, `google:`-sourced events excluded)
**and every task that has a due date** into one chosen Google calendar via
`POST /api/google/push`.

How it behaves:

- **Tasks are mirrored as time blocks.** A task with a due date is pushed
  under the mapping key `task:<taskId>`, so it never collides with an event
  copy. A timed due date becomes a block that starts at that time and lasts as
  long as the task's estimate (default 30 min, minimum 5); a due date at
  midnight becomes an all-day entry. Notes, subtasks, priority and category go
  into the description, and a completed task keeps its copy with a `✓` prefix —
  so Google reflects what the app shows instead of quietly dropping work.
  Tasks that were scheduled onto the calendar (`eventId`) are not mirrored a
  second time, and undated tasks never reach Google.
- **Choose a target** in Settings → Google Calendar → *Push to*. Only
  calendars with a writable role (`owner`/`writer`) are listed, and
  `POST /api/google/push-target` re-verifies the role server-side (403 for
  read-only, 400 for an unknown calendar). Main-calendar events are never
  pushed back into the calendar they were imported from.
- **Diffing, not re-uploading.** The server keeps a `pushed` mapping
  (`localEventId → {calendarId, eventId, contentKey}`) inside
  `google-auth.json`. Unchanged events are skipped; changed content is
  patched; deleted events are removed on Google; switching the target
  calendar moves every event (insert in the new calendar, delete the old
  copy).
- **The pushed list is authoritative.** A mapped event missing from the
  payload is deleted, so the push only runs after a complete event set is
  available (mount + debounced sync/edits).
- **Progress is persisted per batch.** The mapping is flushed to
  `google-auth.json` after every batch that changed something, so a run that
  dies halfway (token expiry → the 401 retry, a restart, a dropped
  connection) keeps the copies it already made: the retry skips them instead
  of creating a second, untracked copy.
- **Copies are stamped.** Every event the app creates carries
  `extendedProperties.private` (`pcApp: personal-calendar` + the local
  `pcLocalId`), so `GET /api/google/events` recognises and skips our own
  copies even when the mapping no longer knows them. That is what keeps a
  stray copy from being imported back as a duplicate of the event it mirrors.
  (Events created by the legacy single-event route get the stamp too.)
- **Stray copies are swept.** Copies left behind by an earlier push — the
  fallback target used before one was chosen, a target switch whose delete
  failed, a run that died — are removed from the *other imported* calendars
  once per push target (and again after any failed push). Only copies that are
  provably ours are touched: tagged ones, or ones whose content matches a
  local event the mapping also has a copy of. The target calendar itself is
  never touched, and the push response reports the count as `swept`.
- **The app also ignores mirrors.** As a second line of defence the frontend
  drops a Google import whose title and start/end exactly match a manual or
  Magister event (`src/integrations/duplicates.ts`), so a leftover copy can
  never show up twice in the calendar — Google-vs-Google matches are left
  alone.
- **Limits:** max 2000 events per request (512 KB body), 3 concurrent
  Calendar API calls, one retry with backoff on 429, and a token refresh +
  single retry on 401. Concurrent pushes answer `429 {ok:false}` — the
  frontend treats this as "busy" and retries later rather than showing an
  error.

Because events are pushed by the server, the write scope `calendar.events`
must stay in `GOOGLE_SCOPES` (§9.1). Accounts connected before the scope
was added need one re-consent (Settings → Disconnect → Connect). No extra
env vars, Nginx rules or storage migrations are required: the mapping,
`pushCalendarId` and the sweep bookkeeping (`sweepTarget`/`sweepAt`) live in
the existing `google-auth.json`, and `GET /api/google/events` filters out
events that this app pushed so imports never re-import them.

```bash
# after at least one push, the status route reports the target + result:
curl -s https://calendar.f1nn.me/api/google/status   # pushCalendarId, lastPushAt, lastPushError
```

### 9.6 Why duplicates appeared (and how they self-heal)

The first push after a deploy may run before Settings saved a target, so it
falls back to the account's primary calendar. A run that failed after
creating part of the set used to lose those copies (the mapping was only
written at the end), and the retry created them again — the first batch then
lived on in the primary calendar unknown to the mapping, came back through
the import as `google:` events and showed every lesson twice.

Three independent guards now prevent that, so no manual cleanup is needed:

1. progress is flushed per batch → no re-creation after a failed run,
2. tagged copies are never imported, mapping or not,
3. the sweep deletes provably-ours strays from imported calendars, and the
   frontend drops any remaining mirror of a local/Magister event.

On the first push after the upgrade the sweep cleans up the old strays; the
count shows up as `swept` in the push response (and the calendar is tidy
again after the next sync).

## 10. Password lock (private calendar)

The whole app can sit behind one password. It is **off by default** and
enabled purely by setting one environment variable on the Pi:

```bash
# On the Pi
echo 'APP_PASSWORD=choose-a-long-password' >> /opt/personal-calendar-proxy/.env
sudo systemctl restart personal-calendar-proxy
```

Check the result:

```bash
curl -s https://calendar.f1nn.me/api/session
# {"ok":true,"required":true,"unlocked":false}

curl -i -X POST https://calendar.f1nn.me/api/unlock \
  -H 'Content-Type: application/json' -d '{"password":"wrong"}'
# 401 + {"ok":false,"error":"Incorrect password"}

curl -i -X POST https://calendar.f1nn.me/api/unlock \
  -H 'Content-Type: application/json' -d '{"password":"choose-a-long-password"}'
# 200 + Set-Cookie: pc_unlock=…; HttpOnly; SameSite=Strict; Secure

curl -s https://calendar.f1nn.me/api/storage            # 401 {"error":"locked"}
curl -s -H 'Cookie: pc_unlock=…' https://calendar.f1nn.me/api/storage
```

How it works:

- **The password never reaches the browser.** It lives only in `APP_PASSWORD`
  on the Pi and is compared server-side in constant time. Nothing about it is
  in the JS bundle, so it cannot be read out of the page source.
- **Unlocking is once per browser.** A correct password returns an `HttpOnly`
  session cookie (180 days, `Secure` whenever the request arrived over TLS —
  Nginx forwards `X-Forwarded-Proto`). The browser sends it on every later
  request, so there is no prompt on reload. The app re-checks on mount and
  whenever the tab regains focus.
- **The app is never mounted while locked**, so a locked browser runs no sync,
  no Google push and no storage read at all.
- **Locked routes:** `/api/storage`, `/api/google/*` and `/ics` — i.e. your
  events, tasks, feed, and the Google connection.
- **Exempt on purpose:** `GET /api/session`, `POST /api/unlock`,
  `POST /api/lock` (the app needs them to ask), `GET /api/google/callback`
  (Google redirects back as a cross-site navigation, which carries no
  `SameSite=Strict` cookie), and `/api/webhook/*` + `/api/v1/*` (the ESP32 and
  the task webhook authenticate with `DEVICE_TOKEN` / `WEBHOOK_TOKEN`).
- **Guessing is throttled:** 8 wrong attempts from one IP within 15 minutes
  earns a 5-minute block (HTTP 429). The IP comes from the `X-Real-IP` /
  `X-Forwarded-For` headers Nginx already sets.
- **Rotating the password logs everyone out.** Sessions are fingerprinted with
  the password, so changing `APP_PASSWORD` and restarting invalidates every
  cookie — including your own, so unlock once more. To revoke everything
  without changing the password, delete `access-sessions.json` next to
  `data.json` and restart.
- **Locking one browser by hand:** Settings → *Lock* (only shown while the
  lock is enabled) clears the cookie and reloads the page into the lock
  screen. Unlocking needs the password again.

What this does *not* do — worth knowing:

- The static page itself (`index.html`, `assets/…`) is still public: Nginx
  serves it before the app is ever asked. The lock protects **the data**, not
  the existence of the page or its JavaScript. To hide the page from the
  internet as well, add `auth_basic` in Nginx (§5) on top of this.
- The app keeps a `localStorage` cache of your events and tasks. On a device
  that was unlocked before, that data stays readable in devtools — clear site
  data when handing a device to someone else.
- If the server cannot be reached, the app **fails open** and shows the
  localStorage copy: a locked-out visitor gains nothing, but an offline owner
  can still reach their own calendar. The server data itself is never readable
  without the session cookie.
- The lock is plain HTTP-level protection, not encryption: everything is TLS
  only because Cloudflare/Nginx terminate TLS in front of it.

Changing the password again is just the same two commands from the top. If you
forgot it, remove the `APP_PASSWORD=` line and restart — the app is public
again until you set a new one.
