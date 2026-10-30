# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A K-pop album preorder store: PHP 8.3 + Apache backend (`preorderkpopweb/api/`), vanilla HTML/CSS/JS frontend (`preorderkpopweb/`), MySQL via PDO. Runs on MAMP for local dev, deploys to Railway via Docker.

There is a leftover `server.js` (Express) + `package.json` from an earlier prototype. It only serves static files and **cannot run the PHP API** — it exists solely so `npm test` has a runner; it is not the app server. The real backend is PHP+Apache (see Deployment below).

## Commands

```
npm test                    # run all test files (tests/run-all.mjs), <1s, no npm install needed
node tests/<file>.test.mjs  # run a single test file directly
node tests/e2e/smoke.mjs http://localhost:8080   # headless-Chrome smoke test of the running site (not in npm test)
```

The e2e smoke test needs a running site (Docker/MAMP) and local Chrome; it defaults to the sample accounts from `database/kpop_store.sql` — against the live site pass real accounts via `SMOKE_CUSTOMER_EMAIL`/`SMOKE_CUSTOMER_PASSWORD` (+ `SMOKE_SKIP_ADMIN=1` or `SMOKE_ADMIN_*`).

Tests load the real `preorderkpopweb/js/store.js` into a simulated `localStorage`/`fetch` environment — the business logic under test is the same code that runs in the browser. `store.js` branches on whether `KpopApi`/`fetch` exist: present → talks to the PHP API, absent → falls back to raw `localStorage` (this fallback path is also what the tests exercise). Read `docs/TESTING.md` before touching order/rate/quota logic — it has the full checklist including things that must be verified manually in a browser.

No build step (`npm run build` is a no-op) and no linter is configured.

### Local dev (MAMP)

Document Root must point at `preorderkpopweb/`. Import `database/kpop_store.sql` via phpMyAdmin (idempotent — `DROP TABLE IF EXISTS` up front, but re-importing wipes data). DB connection config lives solely in `preorderkpopweb/api/config.php`; if MAMP's MySQL port isn't 3307/3306, edit `DB_PORTS` there. Full walkthrough: `README.md`.

### Local dev (Docker, alternative to MAMP)

`docker compose up -d --build` → site on http://localhost:8080, phpMyAdmin on :8081. `web` builds the same Dockerfile Railway uses and bind-mounts `preorderkpopweb/` (edits show up without rebuilding); uploads live in a named volume, as on Railway. `db` is MySQL 9.4 (Railway's version) and auto-imports `database/kpop_store.sql` only when its volume is empty — `docker compose down -v` to re-seed. Both `.sql` files start with `SET NAMES utf8mb4;`: without it the MySQL image's init import reads the file as latin1 and double-encodes all Thai text. `docker-compose.yml` is local-only; Railway ignores it.

## Architecture

### Sync-read / async-write data layer

Every page loads data in one shot, then reads happen synchronously against an in-memory copy for the rest of the page's life:

```
open page → api/bootstrap.php (single request) → cached in memory
          → KpopStore.ready(fn) releases page-render code
click     → await KpopStore.addOrder(...) → POST to API → refetch to overwrite cache
```

If `bootstrap.php` fails (Railway's MySQL sleeps when idle and takes ~10–20s to wake), `ready()` retries for ~20s before giving up; on final failure it fills the cache with empty values so getters don't fall back to the `DEFAULT_*` sample data baked into `store.js`. Load state is exposed via `KpopStore.onLoadStatus(fn)` (`loading`/`retrying`/`ok`/`failed`) and `ui.js` renders the "connecting…/failed + retry" bar — keep that split, `store.js` doesn't render.

This exists because the page-render code across all HTML files calls data-layer getters synchronously in the middle of loops that build DOM — converting every call site to async would mean rewriting all rendering. So instead: reads stay sync (from memory), writes are the only async boundary. `preorderkpopweb/api/bootstrap.php` is the one endpoint that assembles everything a page needs (products, rounds, rates, orders scoped to the viewer, notifications, cart, users) in a single request; it also enforces per-viewer visibility (admin sees all orders in full, a customer sees their own in full and everyone else's reduced to id/status/round/qty for quota display, an anonymous visitor gets only the quota-safe view).

Script load order on every page is fixed: `js/api.js` → `js/store.js` → `js/ui.js` → `js/pages/<page>.js`. `store.js` is the data layer (no DOM access); `ui.js` is navbar/modals/mobile nav and must load after it; `js/pages/<page>.js` holds that page's own code (classic script, so its functions stay global for the `onclick="..."` attributes in the HTML). HTML files contain no inline `<style>`/`<script>`: CSS is `css/responsive.css` → `css/common.css` (storefront pages only, not admin) → `css/pages/<page>.css`, in that order so each page can override the shared rules.

**Business rules that touch money, quota, or admin rights are re-validated in PHP regardless of what the browser sends** — the client is never trusted for these.

### Order status as data, not strings

`ORDER_STATUS` in `js/store.js` is a lookup table of flags (`revenue`, `quota`, `canCancel`, `canReuploadSlip`, etc.) keyed by status code. The Thai `text`/`short` fields are display-only. This replaced an earlier design that matched on Thai status *strings* scattered across files, which broke when one status's text was a substring of another's. Never branch on the display text; always branch on the status code's flags.

### Notifications are typed and clickable

`push_notification($email, $title, $message, $type, $ref)` in `helpers.php` stores what the notification is about (`type`) and what it points to (`ref`: order id or user id); the documented list of types is on that function. `ui.js` maps `type` → icon/colour (`NOTIFICATION_KINDS`) and, in `openNotification()`, → where a click goes (admin types → `handleAdminNotification()` in `js/pages/admin.js`, or `admin.html?noti=…&ref=…` from other pages; `order` → `order-history.html?order=…`; `password_reset` → change-password modal). Same rule as order status: never infer the kind from the Thai title. Admin broadcasts have no type and aren't clickable. The admin backoffice has its own bell (`renderAdminNotificationBell()`), since its header doesn't go through `renderNavbarAuth()`.

Schema upgrade for DBs imported before `type`/`ref` existed (e.g. Railway) is automatic: `ensure_schema_once()` runs at the top of every API request (before any transaction — `ALTER TABLE` implicitly commits in MySQL) and only does work once per container, remembered by a flag file in the temp dir; any "unknown column" error deletes the flag so the next request re-checks. Follow this pattern for future additive columns instead of asking for a manual migration.

### Exchange rate (KRW → THB)

The rate is a hardcoded constant, `CENTRAL_RATE` in `preorderkpopweb/api/config.php` (mirrored client-side as `CENTRAL_RATE` at the top of `js/store.js`). `current_rate()` in `helpers.php` and `KpopStore.getCurrentRate()` in `store.js` both just return this fixed value — no database lookup, no admin UI, no history. To change the rate, edit the constant in both files and deploy/redeploy.

Every order still records the rate it was created with (`orders.rate_used`, `orders.rate_locked_at`), so past orders stay correct if `CENTRAL_RATE` is ever changed later.

There used to be an append-only `rates` table (admin-editable rate history, and briefly an auto-fetch-from-external-API path) — that whole system was removed in favor of one constant. The `rates` table still exists in the DB schema for both local and Railway (nothing drops it), but nothing reads or writes it anymore; it's orphaned.

### Auth & sessions

Real password auth (`password_hash()`/`password_verify()`) against `users.password_hash` — no auto-provisioning of accounts on login, unlike the old demo build. Login failure message is intentionally identical for "no such email" and "wrong password" to prevent account enumeration.

"Forgot password" emails a reset link: `auth.php?action=forgot` (public; same reply whether or not the account exists; per account max 1 link / 2 min and 5 / hour) stores only the SHA-256 of a random token in `password_resets` (single-use, 30 min) and mails `reset-password.html?token=…`; that page calls `reset-token-status` then `reset-with-token`, which invalidates every outstanding link for the account. Invalid/expired links come back with `code: 'invalid_link'` — branch on that, not the Thai message. Mail goes through `send_mail()` in `helpers.php` over an HTTPS API (Brevo or Resend, chosen by `MAIL_PROVIDER`/`MAIL_API_KEY`/`MAIL_FROM` env vars) because Railway's Free/Hobby plans block SMTP. Unconfigured: outside production the mail is appended to `/tmp/kpop-mail-outbox.log` in the container (that's how to test locally); in production `send_mail()` returns false and `forgot` falls back to the admin-assisted path below so the request isn't lost. Reset links are built from `app_base_url()` (`APP_BASE_URL` or Railway's `RAILWAY_PUBLIC_DOMAIN`) — never from the request's Host header, which an attacker controls.

Admin-assisted reset still exists: the shop-inbox notification → admin clicks the key button in the users tab (`users.php?action=reset-password`, never for their own account) and gets a random temp password once (`random_temp_password()`, no 0/O/1/l/I because it's read out over the phone) → customer changes it via `auth.php?action=change-password` (requires the current password). Accounts the admin creates also get a random temp password shown once — there is no fixed default password. Sessions are PHP's default file-based sessions stored in the container filesystem — **every deploy restarts the container and logs everyone out**, and running more than one replica would split sessions across instances, so Railway is configured for exactly one replica.

### File uploads

Payment slips and product images are stored as real files under `preorderkpopweb/uploads/`, with only the path saved in MySQL. On Railway this path is a mounted volume; `uploads/.htaccess` (blocking script execution in that folder) gets clobbered by the volume mount on every deploy, so `docker-entrypoint.sh` restores it from a copy kept outside the mount point at container start.

## Deployment (Railway)

Deploys from Dockerfile (`php:8.3-apache`), **not** `railway.json` and **not** `server.js` — `railway.json` alone does not force Railway off its default Nixpacks/Railpack builder; the Dockerfile path must also be set explicitly in the service's Settings → Build. The Dockerfile forces Apache onto `mpm_prefork` only (required by `mod_php`; two loaded MPMs crash Apache at start with `AH00534`). Full step-by-step, including the MySQL volume setup and the Railway-specific SQL import file (`database/kpop_store_railway.sql`, same schema minus `CREATE DATABASE`), is in `docs/DEPLOY.md` — read it before changing anything deploy-related, it documents failure modes hit during the real deploy.

Push to `main` auto-triggers a Railway build; if a change doesn't get picked up, redeploy manually (`railway redeploy --service web --yes`) and check `railway logs --deployment --service web`.
