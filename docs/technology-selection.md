# Technology selection: maps, routing, geocoding

Research date: October 2026. **Method caveat:** the build environment could not open most provider websites directly. Apart from GitHub pages, which were read in full, the facts below come from search-engine extracts of the official pages linked. Confirm exact quotas and prices on the live pages before you sign anything.

## The five separate components

| Component | What it does | Chosen for the prototype |
|---|---|---|
| Rendering library | Draws the map in the browser | **Leaflet 1.9.4** (BSD-2-Clause), served locally from `node_modules` |
| Map data | Roads and places | **OpenStreetMap** (ODbL; attribution required) |
| Tile hosting | Serves map images | **tile.openstreetmap.org**, for development only. Configurable through `MAP_TILE_URL` |
| Geocoding | Text → coordinates | **Photon** (komoot public instance), or ORS geocoding |
| Routing engine | Coordinates → route | **OSRM demo** (car only) by default; **openrouteservice `driving-hgv`** (truck) with an API key |

A free library such as Leaflet or MapLibre does **not** include free tiles, geocoding or routing. Each of those is a separate service with its own terms.

## Provider comparison

| Option | Interactive map | Routing | Truck routing and restrictions | Cost / free tier | Commercial-use notes | Fit for a small LT start-up |
|---|---|---|---|---|---|---|
| **Leaflet** / **MapLibre GL JS** | Renderer only | – | – | Free (BSD-2 / BSD-3) | No restrictions | ✅ Renderer of choice (Leaflet = raster, simplest; MapLibre = vector) |
| **OSM standard tiles** ([policy](https://operations.osmfoundation.org/policies/tiles/)) | ✅ | – | – | Free, donation-funded, no SLA | Heavy use needs permission. No bulk or offline download. Valid User-Agent/Referer required. Visible "© OpenStreetMap contributors". | ⚠️ Development and low traffic only |
| **MapTiler** / **Stadia Maps** ([MapTiler](https://www.maptiler.com/cloud/pricing/), [Stadia](https://stadiamaps.com/pricing/)) | ✅ hosted OSM tiles | – | – | Free plans are non-commercial. Stadia Starter ≈ $20/month is commercial. | Attribution plus provider logo/credit | ✅ Cheapest production tile path |
| **OSRM demo** ([policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy)) | – | ✅ | ❌ Car, bike and foot profiles only | Free | ≤ 1 req/s, "reasonable, non-commercial" use, no guarantees | ⚠️ Development default only; **not truck-compliant** |
| **openrouteservice** ([routing options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options), [plans](https://openrouteservice.org/plans/)) | – | ✅ | ✅ `driving-hgv` with `vehicle_type=hgv` and restrictions on height, width, length, weight, axle load and hazmat | Standard plan free: 2,000 directions/day (40/min), 3,000 geocoding/day | Commercial use within Standard limits: **unverified** (no explicit ToS clause found). Credit "© openrouteservice.org by HeiGIT, Map data © OSM contributors". | ✅ **Recommended initial truck routing**; restrictions depend on OSM tagging quality |
| **Photon** ([README](https://github.com/komoot/photon)) | – | – | – | Free public instance, "reasonable" use | Throttled or banned on heavy use; no availability guarantee | ✅ Prototype autocomplete; self-host or replace for production |
| **Nominatim public** ([policy](https://operations.osmfoundation.org/policies/nominatim/)) | – | – | – | Free | ≤ 1 req/s per application. **Client-side autocomplete forbidden.** Per the search extract, must not be built into or suggested by AI/no-code app builders. | ❌ Not used, deliberately |
| **Google Maps Platform** ([pricing FAQ](https://developers.google.com/maps/billing-and-pricing/faq), [truck routing](https://developers.google.com/maps/documentation/routes/lvr)) | ✅ | ✅ | ⚠️ Routes API `TRUCK` mode is limited availability (US GA); EU/LT availability unverified | Free monthly calls per SKU (10k / 5k / 1k by tier) since March 2025 | Routes content may not be shown on non-Google maps; stricter EEA terms since July 2025 | ❌ Poor fit with Leaflet + OSM; EU truck routing doubtful |
| **HERE** ([truck routing](https://docs.here.com/routing/docs/routing-v8-truck-routing)) | ✅ | ✅ | ✅ `transportMode=truck`: dimensions, gross/axle weight, hazmat, tunnel category | Base plan with free monthly thresholds (exact figures unverified); credit card needed | "© HERE" on every map | ✅ Strong commercial upgrade path for EU truck data |
| **TomTom** ([terms](https://developer.tomtom.com/terms-and-conditions)) | ✅ | ✅ | ✅ `travelMode=truck` with dimensions, weight, axle weight, load type, ADR tunnel code | Free quotas (figures conflict between official pages) | Free use is "Evaluation Use" only without a subscription | ✅ Commercial upgrade alternative |
| **Sygic** ([Professional Navigation SDK](https://www.sygic.com/enterprise/professional-gps-navigation-sdk)) | In-app SDK | ✅ | ✅ Truck navigation SDKs | **No public pricing; sales quote only** | Licensed per deal | ⚠️ Suited to an in-cab driver app (Arnas's area), not a browser routing API |
| **GraphHopper** ([pricing](https://www.graphhopper.com/pricing/)) | – | ✅ | Truck profiles on paid plans only | Free plan non-commercial (500 credits/day) | – | ⚠️ Paid option |

## Recommendation

1. **Now (prototype):** Leaflet + OSM tiles + Photon + OSRM demo, at zero cost and with no keys. The UI labels the route **"car routing — not truck-compliant"** everywhere.
2. **As soon as possible:** set `ROUTING_PROVIDER=openrouteservice` with a free ORS key to get real HGV routing with the truck's dimensions and weights.
3. **Before public launch:** switch `MAP_TILE_URL` to a paid tile host (Stadia or MapTiler) or self-hosted tiles. Self-host Photon or use a commercial geocoder. Evaluate HERE or TomTom truck routing against ORS on Lithuanian test routes (bridges, town weight limits).
4. **Driver navigation (Arnas):** Sygic belongs in a mobile driver app. Its output feeds the calculators through the provider-independent `RouteInput` contract (see `docs/logistics-module.md`).

No rewrite is needed for any of these steps:

- **Tiles:** change an environment variable.
- **Routing:** add one adapter file under `backend/src/services/routing/providers/`.
- **Geocoding:** add one adapter under `backend/src/services/geocoding/providers/`.
