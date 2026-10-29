# HaulPair — end-user version (`user-ui` branch)

The main app at `/` is for ordinary farmers and carriers. UI copy is Lithuanian; code,
comments and commits are English. Everything technical stays in the backend.

## Flow

| Step | Screen | What the user sees |
|---|---|---|
| 0 | `#/login` | Demo login: any username/password. Fields clear on submit; nothing is stored or sent. A role selector picks the demo account: **Piemuo** (Siuntėjas) or **Linas Agro** (Vežėjas). The header always shows name + role and a log-out button; a **DEMO** badge is always visible. |
| 1 | `#/book` | Exactly four inputs: **Iš kur?** (place search), **Į kur?** (searchable drop-off dropdown grouped by type and region, with a free-text address fallback), **Krovinys**, **Kiekis (t)**. One primary button. |
| 2 | `#/book/result` | Map with the truck route, **one total price**, one button **Tęsti užsakymą**. A DEMO-route badge appears when no truck router is configured. |
| 3 | `#/book/details` | Pickup calendar (past days disabled, up to 120 days ahead), time window, optional **Užsakau kaip įmonė** → legal-entity window (company name, 9-digit company code, optional VAT `LT`+9/12 digits, address, contact, phone, e-mail, invoice toggle; demo notice, pre-filled for both demo accounts, stored nowhere). |
| 4 | `#/orders/:id` | Bolt/Uber-style order page: full-screen map + bottom sheet with truck type and plate, demo driver, ETA countdown, pickup date and window, cargo/route summary, status timeline (Užsakyta → Sunkvežimis priskirtas → Pakeliui → Atvyko → Pakrauta → Pristatyta) and one primary action per state. **DEMO live** badge. |
| — | `#/orders` | The user's demo orders (kept in this browser only). |
| — | `#/exchange` | **Krovinių birža**: read-only DEMO cargo offers and available trucks. No matching. |
| — | `#/prices` | **Kainos ir geriausias maršrutas** (carrier account): diesel price and grain prices at drop-off points with source, timestamp and trend; route planner ranking drop-off points by net result. The only place a fuel price appears. |

## Backend logic

- **Fleet** (`data/booking/fleet.json`, editable seed data): small tipper (≤7.5 t), 14 t
  rigid, 24 t-class grain truck, 40 t combination — payload, volume, gross weight,
  height, width, length, axle load, fuel use empty/full. No driver costs.
- **Truck selection** (`services/booking/truckSelection.js`): capacity =
  min(payload, volume × planning density of the cargo); smallest fitting profile;
  loads above one truck are split into the fewest trucks. 10 t of wheat → 24 t class.
- **Truck routing** (`services/routing/truckRouter.js`): openrouteservice
  `driving-hgv` with the selected truck's restrictions when `ORS_API_KEY` is set;
  otherwise — or if ORS is unreachable/over quota — a labelled DEMO route.
- **Pricing** (`services/booking/pricing.js`, config `data/booking/pricing.json`):
  deterministic; fuel (loaded + configured empty-return share, consumption
  interpolated by load) at the current diesel price + vehicle distance cost +
  vehicle time cost + tolls, × (1 + margin), minimum per truck, rounded up to whole
  euros. **Driver expenses are excluded everywhere** (the catalog loader rejects
  driver-cost keys). The quote response holds only the total, map geometry and an
  **encrypted** quote token, so the browser never receives fuel price or truck plan.
- **Diesel price — the only AI-managed input** (`services/fuelPrice/dieselPriceService.js`,
  `services/ai/dieselPriceAi.js`): when AI is ready, Gemini with Google Search
  grounding reports the Lithuanian average diesel price (preferably LEA); the backend
  parses it, checks 1.0–3.5 EUR/l and a current date, caches it with a timestamp in
  `fuel_prices` (+ `fuel_price_history`), and on any failure keeps the last known
  good value. Admin LEA import (`POST /api/fuel-price/import`) feeds the same store.
  With nothing stored, a seeded DEMO value is used and labelled.
- **Planner** (`services/booking/plannerService.js`): revenue (grain price × t) −
  transport cost (fuel at the tracked diesel price + tolls; no driver costs, no
  margin); ranked by net per trip, with net per tonne; best + runner-up.
- **Live tracking** (`frontend/js/user/tracking.js`): a `PositionProvider` interface;
  the DEMO simulator interpolates the truck along the routed polylines at the speed
  implied by each leg's routed duration and drives the timeline from the position.
  A telematics feed can implement the same interface later.

## Data sources and what is real

| Item | Status |
|---|---|
| Truck route | Real HGV route with `ORS_API_KEY` (openrouteservice Standard plan: 2,000 directions/day, 40/min per the official plans page as found by search — verify before launch). Without a key: DEMO line. |
| Place search | Configured geocoder (Photon by default, no key). If unreachable: offline list of Lithuanian town centres, labelled demo. |
| Diesel price | LEA (Lietuvos energetikos agentūra, ena.lt) publishes daily averages — imported by admin, or fetched by Gemini+Search when `AI_ENABLED=true` and a key is set (verify Google free-tier and EU terms first; 0 € budget → leave off if paid). Otherwise seeded **DEMO**. |
| Grain purchase prices | No free, legitimate machine-readable per-site source was found. Seeded **DEMO** data behind an adapter (`services/booking/marketPrices.js`) with a fallback. Agricultural Data Center (ŽŪDC) publishes national weekly averages; a contracted buyer feed would be needed per site. |
| Drop-off points | 13 real companies/sites; names and street addresses checked against public registers/directories (sources in `data/booking/dropoff-points.json`). Coordinates could not be verified from the build environment and are approximate → every entry is labelled **DEMO** until verified. |
| Orders, drivers, plates, exchange, accounts, login | DEMO only. Orders are kept in the browser's localStorage; nothing is sent to a carrier. |

## Configuration

`TRUCK_ROUTING_PROVIDER` (`auto`|`openrouteservice`|`demo`), `ORS_API_KEY`,
`PRICING_MARGIN_PCT`, `DIESEL_AI_REFRESH_HOURS`, `AI_ENABLED`, `GEMINI_API_KEY`,
`GEMINI_MODEL`, `FUEL_PRICE_ADMIN_TOKEN`, `ADVANCED_TOOLS_ENABLED` — see `.env.example`.
