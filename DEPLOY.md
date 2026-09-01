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

The Pi is assumed to live at `/home/finn/Documents/Sites/personal-calendar`.

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

## 7. Security notes

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
