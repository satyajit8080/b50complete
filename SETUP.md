# Bull50 — VPS Setup (Step 1: Scaffold + Auth)

## 1. Upload this folder
Copy the whole `bull50/` directory to your VPS via WinSCP/SCP/rsync, e.g. `/var/www/bull50`.

## 2. Install Node 20+ (skip if already installed)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should be v20+
```

## 3. Start Postgres + Redis
```bash
cd /var/www/bull50
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
docker compose up -d
docker compose ps   # confirm both are healthy
```
Copy the password printed into `.env` — you'll need it for `DATABASE_URL` below.

## 4. Install dependencies (root, installs all workspaces)
```bash
npm install
```

## 5. Configure API env
```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```
Fill in:
- `DATABASE_URL=postgresql://bull50:<password-from-step-3>@localhost:5432/bull50`
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — generate each with:
  ```bash
  openssl rand -hex 32
  ```
- `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN`, `FINEDGE_API_KEY` — paste your real keys (not used until step 2, but safe to set now)

## 6. Run the first migration
```bash
npm run db:generate
npm run db:migrate -- --name init
```
This creates all tables (User, RefreshToken, Watchlist, Alert, AuditLog, ApiCache).

## 7. Start the API
```bash
npm run dev:api
```
Check it's alive: `curl http://localhost:4000/health` → should return `{"status":"ok",...}`.

## 8. Configure + start the web app
```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > apps/web/.env.local
npm run dev:web
```
Visit `http://your-vps-ip:3000` (open port 3000 in firewall, or set up Nginx reverse proxy — that comes with full deployment in a later step).

## 9. Smoke-test auth
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"testpass123","name":"Satya"}'
```
Should return a `user` object and `accessToken`.

---

# Phase 2 — Market Data Engine

Adds the DhanHQ + FinEdge clients, Redis caching, circuit breakers, BullMQ workers,
and the `/api/market` + `/api/monitoring` routes. Everything below assumes Phase 1
above is already working.

## 10. Re-install dependencies
New packages were added (`bullmq`, `node-cron`). From the repo root:
```bash
npm install
```

## 11. Run the new migration
Phase 2 adds three tables (`HistoricalCandle`, `Instrument`, `ApiHealthLog`) —
purely additive, nothing from Phase 1 is touched.
```bash
npm run db:generate
npm run db:migrate -- --name market_data_engine
```

## 12. Populate the Instrument table
Market data routes resolve symbols (e.g. "RELIANCE") to Dhan's numeric
`securityId` via the `Instrument` table. This needs to be populated from
Dhan's instrument master CSV before `/api/market/quote/:symbol` etc. will
work. (The sync job for this is the next piece to build — for now you can
manually insert a few rows via `npm run db:studio` to test, e.g. NIFTY 50
index, or a few equities you care about.)

## 13. Start the API (same as before)
```bash
npm run dev:api
```

## 14. Start the worker process (new, separate process)
In a separate terminal/PM2 process:
```bash
npm run dev:worker --workspace=apps/api
```
This runs the BullMQ historical-sync worker and the cron scheduler. It does
NOT serve HTTP — it's a background process only.

## 15. Smoke-test market data
```bash
curl http://localhost:4000/api/market/overview/indices
```
Should return Nifty 50, Bank Nifty, India VIX, etc. with live prices —
**requires valid DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN in apps/api/.env**.

```bash
curl http://localhost:4000/api/market/quote/RELIANCE
```
Requires RELIANCE to exist in your Instrument table first (step 12).

## 16. Check circuit breaker / queue health (requires admin login)
```bash
curl http://localhost:4000/api/monitoring/external-apis \
  -H "Authorization: Bearer <accessToken-from-an-ADMIN-user>"
```
To make a user an admin for testing, update their role directly via
`npm run db:studio` (User table → role → ADMIN).

---

## What's still a placeholder in Phase 2
- **FinEdge endpoints**: `getCompanyProfile`, `getRatios`, etc. in
  `apps/api/src/services/finedge/client.ts` have the correct base URL,
  auth, caching, and retry logic, but the exact endpoint **paths** are
  marked `// TODO` pending the real FinEdge endpoint docs. Once you send
  those, only the `path` strings in that file need updating — nothing else.
- **Instrument sync job**: the Instrument table needs to be populated from
  Dhan's instrument master dump. Not yet built — needed before symbol-based
  routes work for more than a few manually-inserted rows.

---

# Phase 3 — Core Data Platform & AI Foundation

Adds: instrument master auto-sync (from Dhan's public scrip master CSV),
corporate actions storage, market breadth engine, top lists engine (gainers/
losers/most active/52w high-low/gap movers/circuits), option chain metrics
(PCR/Max Pain/IV Rank), a production job scheduler (pre-market/live/post-
market/weekly/monthly, all lock-protected against duplicate execution), and
an AI data layer backed by Claude.

**FinEdge fundamentals were explicitly skipped this phase** — still pending
real endpoint docs from Phase 2. Everything else in the Phase 3 task list
was built.

## 17. Re-install dependencies
New package: `@anthropic-ai/sdk`.
```bash
npm install
```

## 18. Add your Anthropic API key
```bash
nano apps/api/.env
```
Set `ANTHROPIC_API_KEY=sk-ant-...` (get one from console.anthropic.com if
you don't have one). Without this, the `/api/market/ai/*` endpoints return
a clear error but everything else in Phase 3 works fine.

## 19. Run the new migration
Adds `CorporateAction`, `MarketBreadthSnapshot`, `TopListEntry`,
`InstrumentSyncLog` tables — additive only.
```bash
npm run db:generate
npm run db:migrate -- --name core_data_platform
```

## 20. Run the instrument sync for real (this is the big one)
This is what actually populates the `Instrument` table from Dhan's public
scrip master CSV — no more manual test rows needed. Start the worker
process if it isn't running:
```bash
npm run dev:worker --workspace=apps/api
```
Then trigger a sync manually (requires an ADMIN user — see Phase 2 step 16
for how to set that):
```bash
curl -X POST http://localhost:4000/api/monitoring/instrument-sync/trigger \
  -H "Authorization: Bearer <admin-accessToken>"
```
Check progress/result:
```bash
curl http://localhost:4000/api/monitoring/instrument-sync/logs \
  -H "Authorization: Bearer <admin-accessToken>"
```
This will also now run automatically every weekday at 09:00 IST via the
scheduler, plus a full weekly re-sync Sunday 02:00 IST.

## 21. Smoke-test the new routes
```bash
# Market breadth (needs the scheduler to have run at least once during market hours,
# or trigger computeMarketBreadth() manually via worker logs)
curl http://localhost:4000/api/market/breadth

# Top lists
curl http://localhost:4000/api/market/top-lists/TOP_GAINERS

# Option chain metrics (needs a real underlying scrip + expiry)
curl "http://localhost:4000/api/market/options/NIFTY/metrics?underlyingScrip=13&segment=IDX_I&expiry=2026-06-25"

# AI market movement summary (requires ANTHROPIC_API_KEY + breadth data to exist)
curl http://localhost:4000/api/market/ai/market-movement
```

## 22. Confirm VPS timezone
The scheduler's cron expressions assume IST. Verify:
```bash
timedatectl
```
If not `Asia/Kolkata`, set it:
```bash
sudo timedatectl set-timezone Asia/Kolkata
```

---

## What's still a placeholder after Phase 3
- **FinEdge fundamentals** — endpoint paths still pending (see Phase 2 notes above).
- **Corporate actions sync worker** — the queue and cron trigger exist
  (`corporateActionsSyncQueue`, post-market 18:00 IST cron job), but the
  actual sync logic depends on FinEdge endpoints, so the worker body is not
  yet implemented. Activates with no further scheduling changes once
  FinEdge is wired up.
- **Volume Shockers / Breakout / Breakdown top-list categories** — schema
  and route support all 12 categories, but only 9 are currently computed
  by `recomputeTopLists()` (gainers, losers, most active, gap up/down,
  upper/lower circuit, 52w high/low). Breakout/breakdown/volume-shocker
  detection needs a defined technical rule (e.g. "volume > 3x 20-day
  average") which wasn't specified — flagging rather than guessing a
  threshold.
- **Admin Panel UI** — this phase built the backend routes the admin panel
  needs (`/api/monitoring/*`), not the frontend pages themselves.
- **Tests, OpenAPI docs** — explicitly out of scope for this pass per
  instruction to prioritize production code over documentation/tests this
  round.

---

# Phase 3b — Sector Engine & Fundamentals Storage

Closes two remaining gaps from the Phase 3 task list.

**Sector strength/rotation**: NSE's official industry classification is
proprietary (no confirmed free API), so sector is proxied via NIFTY
sectoral index membership (NIFTYAUTO, NIFTYIT, NIFTYBANK, etc.) — per your
direction. This requires seeding a mapping table; nothing is guessed.

**Fundamentals storage**: a source-agnostic `CompanyFundamentals` /
`ShareholdingSnapshot` schema and read/write service layer, independent of
FinEdge's actual API contract. Ready for FinEdge to populate once endpoints
are confirmed, and usable via manual admin entry today.

## 23. Run the new migration
Adds `SectorMapping`, `SectorPerformanceSnapshot`, `CompanyFundamentals`,
`ShareholdingSnapshot` tables.
```bash
npm run db:generate
npm run db:migrate -- --name sectors_and_fundamentals_storage
```

## 24. Seed sector mappings (required before sector routes return data)
Find each sectoral index's Dhan securityId (IDX_I segment) — e.g. by
searching the Instrument table for symbols like `NIFTYAUTO`, `NIFTYIT`.
Then, for each stock you want mapped:
```bash
curl -X POST http://localhost:4000/api/monitoring/sector-mapping \
  -H "Authorization: Bearer <admin-accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"securityId":"1333","symbol":"HDFCBANK","sectoralIndex":"NIFTYBANK","sectoralIndexSecurityId":"<nifty-bank-index-id>"}'
```
Or bulk: `POST /api/monitoring/sector-mapping/bulk` with a JSON array of the
same shape (max 1000 per call).

## 25. Smoke-test sector and fundamentals routes
```bash
curl http://localhost:4000/api/market/sectors/strength
curl http://localhost:4000/api/market/sectors/rotation?hoursAgo=24

# Manual fundamentals entry (until FinEdge is wired up)
curl -X POST http://localhost:4000/api/monitoring/fundamentals/manual-entry \
  -H "Authorization: Bearer <admin-accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"securityId":"1333","symbol":"HDFCBANK","periodType":"QUARTERLY","periodEndDate":"2026-03-31","peRatio":18.5,"roe":17.2}'

curl http://localhost:4000/api/market/fundamentals/HDFCBANK/stored
```

---

## What's still a placeholder after Phase 3b
- **Sector mapping data** — the table is real and wired end-to-end, but
  starts empty. Populating it for the full NSE universe means either manual
  entry per stock/sector or building a future sync against each sectoral
  index's published constituent list — not done here since that constituent
  list source wasn't specified.
- **Fundamentals data** — same situation: the storage and API are real and
  complete, but no rows exist until FinEdge is wired up or manual entries
  are made.

---

# Testing

Unit tests cover the pure-logic units: option chain metrics (PCR, Max Pain,
ATM IV, IV Rank/Percentile), the Dhan scrip-master CSV parser, and the
circuit breaker state machine. 47 tests, all currently passing.

**Scope note:** these are unit tests only, for logic that doesn't need a
live DB/Redis/Dhan connection. Integration tests against real infra (auth
flows, actual API calls, worker job processing) are not included — they'd
need a running Postgres/Redis instance to be meaningful, which this
sandbox can't provide. Worth adding once Phase 1–3 are verified live.

## 26. Run the tests
```bash
npm run test --workspace=apps/api
```
Expected: `Test Files  3 passed (3)` / `Tests  47 passed (47)`.

A `.env.test` file with dummy (non-functional) credentials is included so
tests never need real database/Redis access — they only exercise pure
functions that happen to live in files which transitively import the env
validation module.

---

# API Documentation (OpenAPI / Swagger)

A full OpenAPI 3.0 spec is generated directly from the same zod schemas
the routes use for request validation — not a hand-maintained YAML file
that can silently drift from the real API. All 32 routes across
auth/market/monitoring are documented, including which ones are
placeholders pending FinEdge (clearly marked in their descriptions).

## 27. Generate the spec
```bash
npm run openapi:generate --workspace=apps/api
```
This writes `apps/api/src/openapi/openapi.json` and **fails loudly** (exit
code 1) if the number of actual route handlers doesn't match the number
of registered OpenAPI paths — a built-in drift check. Re-run this anytime
you add or remove a route.

## 28. View the docs
Start the API (`npm run dev:api`), then visit:
```
http://localhost:4000/api-docs
```
Interactive Swagger UI — try requests directly from the browser. Raw JSON
spec is also available at `http://localhost:4000/api-docs.json`.

If `openapi.json` hasn't been generated yet, `/api-docs` logs a warning
and is simply unavailable — it does not crash server boot.

---

## What's still a placeholder after this round
- **Integration tests** — see Testing section above.
- **FinEdge fundamentals** — still pending real endpoint paths (unchanged
  from earlier phases).

---

# Admin Panel UI

A Next.js admin section at `/admin`, built against the OpenAPI spec from
the previous step — 6 pages covering everything the current backend
monitoring routes support.

**Pages:** Overview (system health summary, auto-refreshes 15s) · External
APIs (circuit breaker detail) · Queues (BullMQ job counts per queue) ·
Instrument Sync (manual trigger + run history) · Sector Mapping (seed/view
the NIFTY sectoral-index proxy table) · Fundamentals (manual entry bridge
until FinEdge is wired up).

**Design:** extends the existing dark terminal palette from the Stock Page
(`bg`/`panel`/`up`/`down`) rather than introducing a separate admin theme —
added `warn` (amber, for HALF_OPEN/degraded states), `border`, and `muted`
tokens. Monospace throughout (JetBrains Mono), hairline borders, no card
shadows — built for an operator scanning system state, not for persuasion.

**Auth note:** these pages call admin-only endpoints (`requireRole("ADMIN",
"SUPERADMIN")` on the API side) but the admin pages themselves don't yet
check the logged-in user's role client-side or redirect non-admins — they
rely entirely on the API rejecting unauthorized requests (which it does).
Add a client-side role gate before exposing `/admin` publicly, since right
now a non-admin user would see the page shell and error banners instead of
data, rather than being redirected away.

## 29. Start both apps and visit the admin panel
```bash
npm run dev:api      # terminal 1
npm run dev:worker --workspace=apps/api   # terminal 2 (for instrument sync to actually process)
npm run dev:web      # terminal 3
```
Visit `http://localhost:3000/admin/overview`. A real auth gate now exists:
unauthenticated or non-admin visitors are redirected to `/login`. Log in
there with an ADMIN/SUPERADMIN account (see Phase 2 step 16 for how to set
a user's role via Prisma Studio) and you'll land back on the admin
console, authenticated via the same `apiFetch` token flow as the rest of
the app.

**Auth note:** the `/login` redirect is a UX layer, not the actual security
boundary — every `/api/monitoring/*` route is independently protected by
`requireAuth` + `requireRole("ADMIN", "SUPERADMIN")` on the API side, so
even if the frontend gate were bypassed, the backend still refuses
unauthorized requests with 401/403.

## 30. Verify the production build
```bash
npm run build:web
```
Expected: all 8 routes (`/admin` + 6 admin pages + `/login`) compile and
prerender successfully as static pages. Run for real during development —
clean build, zero errors.

---

## What's still a placeholder after this round
- **Bulk sector mapping upload** — the backend supports
  `POST /api/monitoring/sector-mapping/bulk` (up to 1000 at once), but the
  UI only has the single-entry form.
- **Corporate Actions admin page** — the API endpoint exists but always
  returns an empty list (no sync worker writes to it yet, pending FinEdge),
  so a UI page for it wasn't built this round to avoid shipping a page that
  can never show real data.
- **Instrument search/browse page** — referenced in the Sector Mapping
  page's helper text but no dedicated page exists yet.
- **Integration tests** — see Testing section above.
- **FinEdge fundamentals** — still pending real endpoint paths (unchanged
  from earlier phases).

## Production process management (PM2)
Once verified, for persistent running:
```bash
npm install -g pm2
pm2 start "npm run build:api && npm run start --workspace=apps/api" --name bull50-api
pm2 start "npm run build:web && npm run start --workspace=apps/web" --name bull50-web
pm2 save
pm2 startup
```

Nginx reverse proxy + SSL + Dhan/FinEdge integration are covered in the next steps, not this scaffold.
