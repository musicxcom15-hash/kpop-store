# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A K-pop album preorder store: PHP 8.3 + Apache backend (`preorderkpopweb/api/`), vanilla HTML/CSS/JS frontend (`preorderkpopweb/`), PostgreSQL via PDO. Local dev runs on Docker. Production runs the same Dockerfile on Vercel (Container Runtime), with the database and uploaded files on Supabase (Postgres + Storage). It was migrated from MySQL on Railway in Nov 2026. Leftovers kept only for that migration are `railway.json`, `pdo_mysql` in the Dockerfile and `database/tools/`, all removable once Railway is shut down (`docs/DEPLOY.md` part D).

There is a leftover `server.js` (Express) + `package.json` from an earlier prototype. It only serves static files and **cannot run the PHP API** — it exists solely so `npm test` has a runner; it is not the app server. The real backend is PHP+Apache (see Deployment below).

## Commands

```
npm test                    # run all test files (tests/run-all.mjs), <1s, no npm install needed
node tests/<file>.test.mjs  # run a single test file directly
node tests/e2e/smoke.mjs http://localhost:8080   # headless-Chrome smoke test of the running site (not in npm test)
node tests/e2e/api.mjs http://localhost:8080     # hits every DB-writing API endpoint, cleans up after itself (localhost only)
```

Both e2e scripts need a running site (Docker). The smoke test also needs local Chrome. It defaults to the sample accounts from `database/seed.sql`; against the live site, pass real accounts via `SMOKE_CUSTOMER_EMAIL`/`SMOKE_CUSTOMER_PASSWORD` (+ `SMOKE_SKIP_ADMIN=1` or `SMOKE_ADMIN_*`). Run `api.mjs` after any SQL change. It is the only test that exercises the PHP/SQL layer, since `npm test` never touches PHP. To cover the Supabase transaction-pooler code path, also run it against a container started with `DB_EMULATE_PREPARES=1`.

Tests load the real `preorderkpopweb/js/store.js` into a simulated `localStorage`/`fetch` environment — the business logic under test is the same code that runs in the browser. `store.js` branches on whether `KpopApi`/`fetch` exist: present → talks to the PHP API, absent → falls back to raw `localStorage` (this fallback path is also what the tests exercise). Read `docs/TESTING.md` before touching order/rate/quota logic — it has the full checklist including things that must be verified manually in a browser.

No build step (`npm run build` is a no-op) and no linter is configured.

### Local dev (Docker)

`docker compose up -d --build` → site on http://localhost:8080, Adminer (DB browser) on :8081. `web` builds the same Dockerfile Vercel uses and bind-mounts `preorderkpopweb/`, so edits show up without rebuilding. Uploads go to a named volume unless `SUPABASE_*` is set in `.env`. `db` is `postgres:17-alpine` (Supabase's major version). It runs `database/schema.sql` then `database/seed.sql` only when its volume (`pg-data`) is empty. To re-seed, remove that volume (`docker compose rm -sf db && docker volume rm projectpreorder_pg-data`); `down -v` also wipes uploads. MAMP is no longer supported, since it only ships MySQL. `docker-compose.yml` is local-only.

## Architecture

### Sync-read / async-write data layer

Every page loads data in one shot, then reads happen synchronously against an in-memory copy for the rest of the page's life:

```
open page → api/bootstrap.php (single request) → cached in memory
          → KpopStore.ready(fn) releases page-render code
click     → await KpopStore.addOrder(...) → POST to API → refetch to overwrite cache
```

If `bootstrap.php` fails (the Vercel container scales to zero after 5 idle minutes, so the first request after a quiet spell is a cold start), `ready()` retries for ~20s before giving up; on final failure it fills the cache with empty values so getters don't fall back to the `DEFAULT_*` sample data baked into `store.js`. Load state is exposed via `KpopStore.onLoadStatus(fn)` (`loading`/`retrying`/`ok`/`failed`) and `ui.js` renders the "connecting…/failed + retry" bar — keep that split, `store.js` doesn't render.

This exists because the page-render code across all HTML files calls data-layer getters synchronously in the middle of loops that build DOM — converting every call site to async would mean rewriting all rendering. So instead: reads stay sync (from memory), writes are the only async boundary. `preorderkpopweb/api/bootstrap.php` is the one endpoint that assembles everything a page needs (products, rounds, rates, orders scoped to the viewer, notifications, cart, users) in a single request; it also enforces per-viewer visibility (admin sees all orders in full, a customer sees their own in full and everyone else's reduced to id/status/round/qty for quota display, an anonymous visitor gets only the quota-safe view).

Script load order on every page is fixed: `js/api.js` → `js/store.js` → `js/ui.js` → `js/pages/<page>.js`. `store.js` is the data layer (no DOM access); `ui.js` is navbar/modals/mobile nav and must load after it; `js/pages/<page>.js` holds that page's own code (classic script, so its functions stay global for the `onclick="..."` attributes in the HTML). HTML files contain no inline `<style>`/`<script>`: CSS is `css/responsive.css` → `css/common.css` (storefront pages only, not admin) → `css/pages/<page>.css`, in that order so each page can override the shared rules.

**Business rules that touch money, quota, or admin rights are re-validated in PHP regardless of what the browser sends** — the client is never trusted for these.

### Order status as data, not strings

`ORDER_STATUS` in `js/store.js` is a lookup table of flags (`revenue`, `quota`, `canCancel`, `canReuploadSlip`, etc.) keyed by status code. The Thai `text`/`short` fields are display-only. This replaced an earlier design that matched on Thai status *strings* scattered across files, which broke when one status's text was a substring of another's. Never branch on the display text; always branch on the status code's flags.

### Notifications are typed and clickable

`push_notification($email, $title, $message, $type, $ref)` in `helpers.php` stores what the notification is about (`type`) and what it points to (`ref`: order id or user id); the documented list of types is on that function. `ui.js` maps `type` → icon/colour (`NOTIFICATION_KINDS`) and, in `openNotification()`, → where a click goes (admin types → `handleAdminNotification()` in `js/pages/admin.js`, or `admin.html?noti=…&ref=…` from other pages; `order` → `order-history.html?order=…`; `password_reset` → change-password modal). Same rule as order status: never infer the kind from the Thai title. Admin broadcasts have no type and aren't clickable. The admin backoffice has its own bell (`renderAdminNotificationBell()`), since its header doesn't go through `renderNavbarAuth()`.

### Database (PostgreSQL on Supabase)

`database/schema.sql` is the whole schema. It is pasted into the Supabase SQL Editor as-is and also runs in Docker. It drops and recreates every table, so never run it against live data. `database/seed.sql` is sample data for local only: it contains public passwords and must never run on Supabase. Things that differ from the old MySQL version and are easy to break:

- **Emails compare case-insensitively only because the code says so.** There is a unique index on `lower(users.email)`, and every lookup is `WHERE lower(email) = lower(?)` (users, `notifications.user_email`). MySQL's collation used to do this implicitly. Any new email query must do the same.
- **RLS is enabled on every table, with no policies, and `anon`/`authenticated` privileges are revoked** (bottom of `schema.sql`). Supabase auto-exposes `public` tables over REST, and its publishable key is not secret. Every new table needs the same treatment. PHP connects as the table owner, so RLS doesn't affect it.
- **Connection:** `config.php` reads one env var, `DATABASE_URL` (a `postgresql://` URI, the format Supabase gives). On port 6543 (Supabase transaction pooler) it switches PDO to emulated prepares, because real prepared statements don't survive that pooler. `DB_EMULATE_PREPARES=1` forces the same mode for testing.
- SQL dialect in use: `ON CONFLICT ... DO UPDATE` (cart, sessions), `DELETE ... USING` (clear-round), `IS NOT DISTINCT FROM` (quota), `COUNT(*) FILTER (WHERE ...)` (reset rate limit). Error codes: `23505` = unique violation, `42703`/`42P01` = missing column/table.
- Timestamps are `TIMESTAMP(0)` without time zone and hold Thai local time written by PHP's `date()` (`date.timezone = Asia/Bangkok` in the Dockerfile). SQL never calls `NOW()`/`CURRENT_DATE`, so the DB server's time zone doesn't matter.

Schema upgrades for an already-created DB: `ensure_schema_once()` (top of `helpers.php`, before the session starts) runs each statement in `SCHEMA_UPGRADES` once per container, remembered by a flag file in the temp dir. Any missing column/table error deletes the flag so the next request retries. To add a column, add it to `schema.sql`, append an idempotent statement (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`) to `SCHEMA_UPGRADES`, and bump the flag's suffix (`kpop-schema-pg1` → `pg2`). Otherwise containers that already checked never re-check. The list is empty today because the Postgres schema started complete.

### Product categories

`products.category` is a code: `album`, `lightstick`, `photocard`, `clothing`, `popup`, `merch`. The list exists twice and must stay in sync: `PRODUCT_CATEGORIES` in `helpers.php` (PHP rejects any other code on save) and `PRODUCT_CATEGORIES` in `js/store.js` (Thai label, icon, `chart` flag). Read it through `KpopStore.getProductCategory()`, which treats a missing or unknown code as `album`, so products from before categories existed still work. Only categories with `chart: true` show the "counts toward HANTEO & GAON" badge. Branch on that flag, not on the code or label. The homepage filter chips only appear when products span at least 2 categories. The `artist` column doubles as the brand for non-K-pop goods (the admin label reads "ศิลปิน / แบรนด์").

`products.source_url` is the shop page the admin buys from. It is internal: `bootstrap.php` strips `sourceUrl` for anyone who is not admin, and `products.php` only accepts `http(s)` URLs.

### Product sizes

`products.sizes` is a comma-separated list (`'S,M,L'`; `''` = no sizes), exposed to JS as an array. Every size of a product shares one price and one quota, so a size records what the customer wants and does not change pricing. A cart line and an order line are keyed by product + `size` (`''` for products without sizes): `cart_items` is unique on `(user_id, product_id, size)`, and `order_items.size` stores it. Validity is "the size is in the product's list, or `''` if the list is empty": `is_valid_size()` in PHP, `KpopStore.isValidSize()` in JS. The server checks it on cart add and order create. Quota checks must sum quantities across all sizes of a product. That applies in `cart.php` (`other_sizes_qty()`), in `orders.php` create/reupload (`$qtyByProduct`), and client-side in `getCartGroupedByRound()` and checkout. Never compare one line's qty to the remaining quota alone. If the admin removes a size that sits in someone's cart, `getCartGroupedByRound()` flags the line `invalidSize` and the round can't be checked out until it's removed. The round purchase summary (`getRoundSummary()`) splits rows by size, so the admin knows what to buy.


### Exchange rate (KRW → THB)

The rate is a hardcoded constant, `CENTRAL_RATE` in `preorderkpopweb/api/config.php` (mirrored client-side as `CENTRAL_RATE` at the top of `js/store.js`). `current_rate()` in `helpers.php` and `KpopStore.getCurrentRate()` in `store.js` both just return this fixed value — no database lookup, no admin UI, no history. To change the rate, edit the constant in both files and deploy/redeploy.

Every order still records the rate it was created with (`orders.rate_used`, `orders.rate_locked_at`), so past orders stay correct if `CENTRAL_RATE` is ever changed later.

There used to be an append-only `rates` table (admin-editable rate history). That whole system was removed in favor of one constant, and the table was dropped in the move to Postgres.

### Auth & sessions

Real password auth (`password_hash()`/`password_verify()`) against `users.password_hash` — no auto-provisioning of accounts on login, unlike the old demo build. Login failure message is intentionally identical for "no such email" and "wrong password" to prevent account enumeration.

"Forgot password" emails a reset link: `auth.php?action=forgot` (public; same reply whether or not the account exists; per account max 1 link / 2 min and 5 / hour) stores only the SHA-256 of a random token in `password_resets` (single-use, 30 min) and mails `reset-password.html?token=…`; that page calls `reset-token-status` then `reset-with-token`, which invalidates every outstanding link for the account. Invalid/expired links come back with `code: 'invalid_link'` — branch on that, not the Thai message. Mail goes through `send_mail()` in `helpers.php` over an HTTPS API (Brevo or Resend, chosen by `MAIL_PROVIDER`/`MAIL_API_KEY`/`MAIL_FROM` env vars) so there's no dependence on outbound SMTP. `send_mail()` returns true only when a provider actually accepted the mail; whenever it returns false (unconfigured, provider error) `forgot` also drops a request in the shop inbox (admin-assisted path below) so the request is never silently lost. Unconfigured outside production it additionally appends the mail to `/tmp/kpop-mail-outbox.log` in the container, which is how to grab the link when testing locally. Reset links are built from `app_base_url()` (`APP_BASE_URL`, else Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, which needs "expose System Environment Variables" turned on) — never from the request's Host header, which an attacker controls.

Admin-assisted reset still exists: the shop-inbox notification → admin clicks the key button in the users tab (`users.php?action=reset-password`, never for their own account) and gets a random temp password once (`random_temp_password()`, no 0/O/1/l/I because it's read out over the phone) → customer changes it via `auth.php?action=change-password` (requires the current password). Accounts the admin creates also get a random temp password shown once — there is no fixed default password. Sessions are stored in the `sessions` table by `DbSessionHandler` (`api/session.php`), not in files. Vercel containers have no durable disk, can run several at once, and scale to zero, and file sessions would log people out at random. A deploy therefore no longer logs anyone out. The handler skips writing for anonymous visitors and for unchanged data until the session is half-expired, to save DB round trips. Lifetime is `session.gc_maxlifetime` (PHP default, 24 min). There is no row locking, which is fine because only login and logout write the session.

### File uploads

Payment slips, product images and purchase proofs go through `storage_put()` in `api/storage.php`:
- **Live site:** if `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set, files go to Supabase Storage (public bucket `uploads`, override with `SUPABASE_STORAGE_BUCKET`), and the DB stores the full public URL.
- **Local:** files go to `preorderkpopweb/uploads/`, and the DB stores `uploads/<name>`.

The frontend puts either form straight into `src`.

Filenames get 96 random bits, because public-bucket URLs are readable by anyone who has them and slips carry customers' bank details. Secret keys (`sb_secret_…`) are sent as `apikey` only. Legacy `service_role` JWTs also get `Authorization: Bearer`. Vercel caps request bodies at 4.5 MB, so `upload.php` limits images to 3 MB, after the browser has already downscaled them. `storage_usage()` (admin storage card) sums `storage.objects` on Supabase and falls back to 0 if that schema isn't there.

`uploads/.htaccess` (blocking script execution) only matters locally now. `docker-entrypoint.sh` still restores it when the volume mount hides it.

## Deployment (Vercel + Supabase)

Vercel builds the root `Dockerfile` (`php:8.3-apache`) with its Container Runtime, which is beta. `vercel.json` forces `"framework": "container"`, because the leftover `package.json`/`server.js` would otherwise be detected as a Node app. The community `vercel-php` runtime was archived on 2026-10-29, so don't switch to it. The Dockerfile forces Apache onto `mpm_prefork` only (required by `mod_php`; two loaded MPMs crash Apache at start with `AH00534`). `docker-entrypoint.sh` rewrites Apache's port from `$PORT` (default 80). `.vercelignore` keeps local uploads and secrets out of CLI deploys.

Env vars on Vercel: `DATABASE_URL` (Supabase transaction pooler), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_ENV=production`, and optionally `MAIL_*`/`APP_BASE_URL`; see `.env.example`. The Vercel function region must match the Supabase region (Singapore recommended), because each page makes several DB round trips. Push to `main` auto-deploys. The full runbook is in `docs/DEPLOY.md`: Supabase setup, migrating data and files from the old Railway MySQL (`database/tools/mysql-dump-to-postgres.sh`, `copy-uploads-to-storage.sh`), Vercel setup, and Railway shutdown. Read it before changing anything deploy-related. While the old Railway service is still connected to the repo, every push also deploys there.
