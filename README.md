# HaulPair (Vilkašia): grain route & transport cost planner

> **End-user version (`user-ui` branch).** `/` is now a simple, Lithuanian-first,
> mobile-first app for farmers and carriers: four booking inputs (from, to, cargo,
> tonnes) → a map with a truck route and **one total price** → pickup day/time and
> optional company details → a ride-hailing-style order page with a moving **DEMO**
> truck. Carriers also get **Kainos ir geriausias maršrutas** (diesel and grain
> prices + best drop-off point) — the only place a fuel price is shown. Pricing is
> deterministic backend code and **excludes all driver expenses**. The legacy
> advanced planner moved to `/advanced.html` and is hidden unless
> `ADVANCED_TOOLS_ENABLED=true`. See **`docs/user-ui.md`** for the flow, data
> sources, assumptions and limits.
>
> ```bash
> npm install && cp .env.example .env && docker compose up -d db && npm run db:migrate && npm start
> ```
> Open http://localhost:3000 and sign in with any name/password (demo).

> **V3 update.** The visible brand is now **HaulPair** (data schemas, records and
> API contracts are unchanged). This release adds server-side **access protection**
> (shared HTTP Basic; mandatory in production), cargo quantity entered in **kg**,
> **optional bulk density (0 allowed)**, a redesigned UI, an optional **Google
> Gemini** "describe shipment" helper (off by default), and an **LEA fuel-price**
> suggestion with manual override. See **`docs/CHANGES-HaulPair-V3.md`** for the
> full change list and deploy steps, and **`docs/ai-gemini-setup.md`** for Gemini.
> Run `npm run db:migrate` to apply migrations `003` and `004`. All settings and
> their defaults are documented in `.env.example`. The sections below describe the
> original foundation; where they say "no authentication", access protection now
> applies (and is required in production).

A foundation for a Lithuanian agricultural freight platform:

- an interactive map of Lithuania and Europe
- truck route calculation through a pluggable routing provider
- transport cost estimation on the server
- calculation history saved in PostgreSQL
- a reusable logistics module: cargo catalog, compatibility checks, savings and commission

The UI is **Lithuanian-first**, with an English switch.

> ⚠️ **Local prototype. No authentication is implemented.** Do not expose the server to the internet. Default values (24 t payload, 30 l/100 km, 1.45 EUR/l) are **editable demo assumptions**, not market prices or vehicle specifications. With the default routing provider, routes are **car routes and are not truck-compliant**; the UI says so on every result.

![Results (test harness, synthetic route)](docs/screenshots/planner-results-lt-test-harness.png)
*Screenshot from the automated browser test, which uses a synthetic route because the build environment had no access to routing or tile servers. With network access you get real OSM tiles and real routes.*

## Contents

- [Quick start](#quick-start)
- [Configuration and API keys](#configuration-and-api-keys)
- [Architecture](#architecture)
- [REST API](#rest-api)
- [Cost formulas](#cost-formulas)
- [Database](#database)
- [Testing](#testing)
- [Implemented vs planned](#implemented-vs-planned)
- [Limitations and production requirements](#limitations-and-production-requirements)

Further documentation:

- [`docs/technology-selection.md`](docs/technology-selection.md): provider comparison with sources
- [`docs/logistics-module.md`](docs/logistics-module.md): cargo, trucks, trailers, compatibility, savings, and the team integration guide

## Quick start

Requirements: **Node.js ≥ 20.11** (tested on 22) and **PostgreSQL ≥ 13** (tested on 16), either installed locally or run through Docker.

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Start PostgreSQL. With Docker:

```bash
docker compose up -d db
```

   Without Docker, create a role and database that match `DATABASE_URL` in `.env`:

```bash
psql -U postgres -c "CREATE USER grain WITH PASSWORD 'grain_dev_password';" -c "CREATE DATABASE grain_transport OWNER grain;" -c "CREATE DATABASE grain_transport_test OWNER grain;"
```

4. Create the schema and seed data:

```bash
npm run db:migrate
```

5. Start the app:

```bash
npm start
```

6. Open **http://127.0.0.1:3000**.

For auto-restart during development, use `npm run dev` instead of `npm start`.

Saved calculations are stored in PostgreSQL. They remain after restarting the app or the database container: Docker keeps them in the `grain_pgdata` volume.

## Configuration and API keys

All settings live in `.env` (see the comments in [`.env.example`](.env.example)). Keys are read **only on the server** and are never sent to the browser. `GET /api/config` exposes only public settings.

| Setting | Default | Notes |
|---|---|---|
| `ROUTING_PROVIDER` | `osrm` | `osrm`: public demo server, **car profile only**, light non-commercial use, no key. `openrouteservice`: `driving-hgv` truck profile with height, width, length, weight and axle-load restrictions. |
| `ORS_API_KEY` | – | Required for `openrouteservice` routing or geocoding |
| `GEOCODER_PROVIDER` | `photon` | `photon` (public fair-use instance) or `openrouteservice` |
| `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION` | OSM standard tiles | OSM tiles are for **development and low traffic only**. Use a commercial tile host in production. |
| `APP_USER_AGENT` | – | Put a contact address here; OSM-community services require an identifying User-Agent |
| `ROUTE_TOKEN_SECRET` | random per process | **Required in production** (≥ 32 chars) |
| `DATABASE_URL` / `TEST_DATABASE_URL` | local Docker values | The test database is **wiped** by the integration tests |

**Getting truck routing (recommended):**

1. Register at <https://openrouteservice.org/dev/#/signup>.
2. Create a token. The free Standard plan gives 2,000 directions per day.
3. In `.env`, set `ROUTING_PROVIDER=openrouteservice` and `ORS_API_KEY=<token>`.
4. Restart the app.

The UI then shows "truck profile", and the vehicle dimensions from the sidebar are sent to the router.

**Protecting keys:**

- Never commit `.env`; it is already in `.gitignore`.
- Rotate a key if it leaks.
- Tile-server keys are visible to browsers by design, so use domain-restricted keys for those.

## Architecture

```
Browser (frontend/, vanilla ES modules + Leaflet)
   │  same-origin JSON only (CSP connect-src 'self')
   ▼
Express 5 API (backend/src)
   ├─ routes/        → URL → controller, zod validation middleware
   ├─ controllers/   → HTTP ↔ service mapping
   ├─ services/
   │   ├─ routing/        provider-agnostic service + adapters (osrm.js, openrouteservice.js)
   │   ├─ geocoding/      provider-agnostic service + adapters (photon.js, openrouteservice.js)
   │   ├─ calculation/    transportCost.js — pure cost engine (no I/O)
   │   └─ calculationService.js  verify route token → reference data → engine → persist
   ├─ lib/logistics/ → reusable module (cargo catalog, compatibility, fuel, costs, savings)
   ├─ database/      → pg pool, SQL migration runner, repositories (parameterised SQL)
   └─ middleware/    → helmet CSP, rate limits, central error handler, pino request logging
PostgreSQL (database/migrations/*.sql)
```

Key design decisions:

- **Signed route tokens.** `POST /api/routes` returns the route and an HMAC-signed token containing the provider's distance and duration. Calculations accept only that token, never a client-typed distance, so every cost uses the routing provider's distance.
- **Swappable providers.** Changing the routing, geocoding or tile provider means adding an adapter or changing an environment variable; no other code changes.
- **Logged honesty.** Every result carries its route profile, warnings, assumptions and the source of each value ("Your input", "Calculated", "Routing provider", "Default assumption").
- **Plain JavaScript, no TypeScript, no build step,** to keep the foundation beginner-friendly. Public functions in `lib/logistics` have JSDoc contracts.

### Project structure

```
backend/src/{app.js, server.js, container.js, config/, routes/, controllers/, services/, lib/logistics/, middleware/, validation/, database/, utils/}
backend/tests/{unit/, api/, integration/, helpers/}
frontend/{index.html, css/styles.css, js/{app,api,map,geocoder,routing,calculations,validation,i18n,dom}.js, assets/}
data/logistics/{cargo-types,trucks,trailers}.json
database/{migrations/001_initial_schema.sql, migrations/002_seed_reference_data.sql, init/}
docs/  docker-compose.yml  .env.example  package.json
```

## REST API

All responses are JSON. Success responses look like `{ data, meta? }`. Errors look like `{ error: { code, message, details[], requestId } }`.

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Health check; database status (returns 503 if the DB is down) |
| `GET /api/config` | Public configuration: tiles, provider capabilities |
| `GET /api/trucks`, `GET /api/cargo-types` | Planner presets and grain types (from the DB, localized `names`) |
| `GET /api/geocode?q=` | Location search proxy (rate-limited, cached) |
| `POST /api/routes` | `{ origin, destination, includeReturn, vehicle? }` → geometry, distance, duration, warnings, `routeToken` |
| `POST /api/calculations/estimate` | Validate and calculate without saving |
| `POST /api/calculations` | Calculate on the server and save (201) |
| `GET /api/calculations?limit&offset` · `GET /api/calculations/:id` · `DELETE /api/calculations/:id` | History |
| `GET /api/activity` | Activity log (route requests, saves, deletions) |
| `GET /api/logistics/catalog?locale=` | Cargo, tractor and trailer catalogs |
| `POST /api/logistics/compatibility` · `/fuel` · `/transport-cost` · `/savings` | Logistics module functions |

Status codes:

| Code | Meaning |
|---|---|
| 400 | Validation error |
| 404 | Not found |
| 413 | Request body too large |
| 422 | Business rule rejected (e.g. cargo exceeds payload) or no route exists |
| 429 | Rate limited |
| 502 / 503 / 504 | Provider or database failure |

## Cost formulas

The formulas live in `backend/src/services/calculation/transportCost.js`, which reuses `lib/logistics/fuelCalculator.js`. Per leg:

- fuel litres = D × C / 100
- fuel cost = litres × price

Totals:

- **Total cost** = fuel + tolls (outbound + return) + loading/unloading + other (driver expenses are excluded by design)
- **Cost per tonne** = total / tonnes delivered
- **Cost per tonne-km** = total / Σ(cargo t × leg km)

How the return trip works:

- The return leg is a **real reverse route** requested from the provider.
- An *empty* return uses the empty-run consumption, or the loaded value if none is given (flagged as an assumption).
- A *loaded* return counts its cargo in tonnes and tonne-km.

Other rules:

- Cargo must be > 0 and ≤ payload.
- Fuel price and consumption must be > 0.
- Money is rounded only for display; full precision is stored.
- An optional volume check uses bulk density (FAO lower bound by default).

## Database

| Table | Contents |
|---|---|
| `truck_configurations` | Planner presets, linked to catalog tractor and trailer IDs |
| `cargo_types` | Grain types with localized names and indicative density |
| `transport_calculations` | Every input, each cost component, the provider and profile, and full `inputs`/`results` JSON (audit and reproduction); `calculation_version` |
| `activity_logs` | Business events, with no IPs or secrets |
| `schema_migrations` | Applied migrations with checksums |

`CHECK` constraints enforce positive values, cargo ≤ capacity and consistent return fields. Indexes are on `created_at` and the foreign keys.

**Route geometry is not stored.** It is large and can be fetched again. On reopen, the app requests the route again **for display only**; the saved distance and costs stay authoritative, and a notice appears if the provider's distance has changed by more than 0.5 %. Store geometry (for example as an encoded polyline or PostGIS `LineString`) once you need it for proof of route, disputes or offline replay.

**PostGIS was deliberately not used yet.** No spatial queries exist today. It becomes worthwhile for freight matching: finding loads within X km of a route, corridor buffers.

## Testing

| Command | Runs |
|---|---|
| `npm test` | Everything; integration tests are skipped if `TEST_DATABASE_URL` is unset |
| `npm run test:unit` | Calculation engine, logistics module, providers, tokens |
| `npm run test:api` | supertest against the app with in-memory test doubles |
| `npm run test:integration` | Real PostgreSQL: migrations, persistence across a new pool, constraints, DB outage |

Before running the integration tests, migrate the test database:

```bash
npm run db:migrate:test
```

**Verified in the build environment:**

- **Automated tests:** 116 pass, including integration against PostgreSQL 16.
- **Server:** starts, serves the frontend and Leaflet, and returns a clean `UPSTREAM_UNREACHABLE` error when providers can't be reached.
- **Browser workflow (headless Chromium):**
  - The check covers validation messages, the capacity check, calculating, saving, reopening (same total), the Lithuanian/English switch, deleting with confirmation, the activity log, and the mobile layout.
  - No console or CSP errors appeared.
  - It used real PostgreSQL with a *synthetic test routing provider*.

**Not verified here, because the network blocked these hosts:**

- live OSRM, openrouteservice and Photon responses
- OSM tile loading

The adapters follow the providers' documented formats and are unit-tested with response fixtures. Run the app with network access to confirm them.

## Implemented vs planned

**Implemented:**

- Real Leaflet map with configurable tiles and attribution.
- Location search:
  - autocomplete (Photon or ORS)
  - Lithuanian quick-fill chips
  - pick a point on the map
  - swap start and destination
- Route request with outbound and return legs.
- Truck restrictions (ORS HGV).
- Sidebar parameters, validated on both client and server.
- Cost engine with return trips and the volume check.
- Persistent history: save, open, delete.
- Activity log.
- Lithuanian-first UI with English, and locale-aware formatting.
- Logistics module: cargo catalog, compatibility, fuel, operating cost, savings and commission.
- Security baseline: CSP, rate limits, JSON size limit, parameterized SQL, redacted structured logs, safe error messages.

**Planned (not implemented):**

- User accounts and authentication.
- Freight board, carriers, shippers.
- Shipment-matching algorithm (Aistis).
- Sygic driver navigation (Arnas).
- A UI for the compatibility and savings modules; the API exists.
- Toll calculation; tolls are user input only.
- Live fuel prices.
- VAT, margins and profitability.
- Fully localized catalog notes.

## Limitations and production requirements

- **Security:**
  - Add authentication and authorization, plus per-user data ownership.
  - Add CSRF protection once cookies are used.
  - Use HTTPS behind a reverse proxy, with `TRUST_PROXY=true`.
  - Use secret management.
  - Run audit and backup routines.
- **Providers:**
  - **OSRM demo:** car-only and non-commercial, so it must not be used for real dispatch.
  - **OSM tiles and the Photon public instance:** not for production traffic. Use paid or self-hosted services.
  - **openrouteservice:** check its commercial terms (unverified).
- **Truck compliance:** HGV routing relies on OSM restriction tags, which can be incomplete. Verify bridges, weight limits and local bans against official sources such as Lietuvos automobilių kelių direkcija. This app does not issue routing permits.
- **Data quality:** see the confidence table in `docs/logistics-module.md`. No manufacturer figure has been verified against the live page yet.
- **Operations:**
  - Add metrics and alerting.
  - Use a shared cache (for example Redis) instead of in-process caches when running several instances.
  - Use distributed rate limiting.
  - Add database backups and retention for `activity_logs`.
