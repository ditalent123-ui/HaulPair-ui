# Logistics module: cargo, trucks, trailers, fuel, costs, savings

Owner: Martynas. Status: **MVP, tested**. All automated tests pass (`npm run test:unit`).

The module is plain JavaScript (ES modules) with JSDoc types, matching the rest of this repository. There was no existing TypeScript code or `AGENTS.md` to follow. It has **no UI, database or navigation-provider dependencies** and can be imported directly:

```js
import {
  checkCompatibility, estimateFuel, estimateTransportOperatingCost,
  calculateSavings, allocateSharedTransport, loadCatalog, localizedName,
} from './backend/src/lib/logistics/index.js';
```

## Files

| Path | Purpose |
|---|---|
| `data/logistics/cargo-types.json` | 17 agricultural cargo types with lt/en names, packaging → trailer options, temperature, hygiene, density and confidence |
| `data/logistics/trucks.json` | 3 tractor models (Green Truck 2025 reference figures) and the 30 l/100 km demo estimate |
| `data/logistics/trailers.json` | 4 trailers (tipper, refrigerated, curtainsider, flatbed placeholder), the 24 t demo payload profile and EU legal maxima |
| `backend/src/lib/logistics/types.js` | Enums, JSDoc contracts, `LogisticsValidationError` |
| `backend/src/lib/logistics/catalog.js` | Loads and validates the JSON catalogs |
| `backend/src/lib/logistics/cargoCompatibility.js` | Compatibility engine and trailer-category suggestions |
| `backend/src/lib/logistics/fuelCalculator.js` | Formula A/B, detour fuel, consumption resolution |
| `backend/src/lib/logistics/routeInput.js` | Provider-independent route contract (for Arnas) |
| `backend/src/lib/logistics/transportCosts.js` | Operating-cost model (fuel vs operating cost vs customer price) |
| `backend/src/lib/logistics/savingsCalculator.js` | Savings, commission and multi-customer allocation |
| `backend/src/lib/logistics/i18n.js` | Lithuanian-first messages with explicit fallback |
| `backend/src/lib/logistics/money.js` | Integer-cent arithmetic, largest-remainder split |
| `backend/tests/unit/logistics/*.test.js` | Tests |

HTTP access (same functions): `GET /api/logistics/catalog?locale=lt|en`, `POST /api/logistics/compatibility`, `POST /api/logistics/fuel`, `POST /api/logistics/transport-cost`, `POST /api/logistics/savings`.

## What is verified and what is assumed

Confidence tags used in the data: `verified_official_source`, `official_source_search_extract`, `third_party_source`, `user_provided`, `demo_assumption`, `unverified_general_knowledge`, `unknown`.

**Nothing is tagged `verified_official_source`.** The build environment could not open the manufacturer pages, so every manufacturer value was seen only in search-engine extracts of those pages. Open the linked pages once and upgrade the tags.

| Value | Status |
|---|---|
| Volvo FH Aero 420 I-Save 21.20 l/100 km; Scania 420 R Super 21.50; DAF XF 430 21.59 | Search extract of the official test report. **The Green Truck test runs at about 32 t GCW**, not 40 t, on a 343 km route in southern Germany. Scania and DAF AdBlue and speed figures are tentative. |
| Volvo engine "D13, 420 hp"; unladen weight 7,152 kg | Third-party / search extract |
| Scania and DAF engine variants | `null`, not confirmed |
| S.KI LIGHT agricultural: 3 axles, 38–59 m³ by configuration | Search extract. `internalVolumeM3 = null` (configuration-dependent). Payload and unladen weight `null`. |
| S.KO COOL SMART 13.4 m: 33 Euro pallets, internal 13,400 × 2,460/2,490 × 2,350–3,050 mm | Search extract. Volume and temperature range `null`. |
| S.CS UNIVERSAL 13.62 m: **34** Euro pallets (not 33), 2,480 mm wide, ≤ 3,050 mm high | Search extract. Volume `null`. |
| Bulk densities: wheat 0.72–0.83, barley 0.61–0.69, oats 0.41–0.43, rye 0.72, maize 0.72 t/m³ | FAO density databases (search extract). Rapeseed `null` (no authoritative source). |
| EU maxima: 40 t 5-axle combination, 4.00 m, 2.55 m (2.60 m refrigerated), 16.50 m, 11.5 t drive axle | Directive 96/53/EC (search extract). Confirm the 40 t clause in the consolidated text. |
| **30 l/100 km** estimated consumption | `demo_assumption`, configurable and overridable |
| **24,000 kg** payload | `demo_assumption`; used only when `useDemoPayloadProfile: true` |
| Temperature needs of vegetables, seeds and generic packaged products | `unknown`, so these always produce `needs_review` |
| Packaging/trailer options, hygiene groups, special conditions | `unverified_general_knowledge`. Reasonable defaults that need expert review. |

No load-adjustment coefficients (for example "+x % fuel per tonne") were added: no verified source was found.

## Compatibility engine

`checkCompatibility({ shipments, trailer: { trailerId, overrides? }, useDemoPayloadProfile?, locale? })` returns:

```js
{ status: 'compatible' | 'incompatible' | 'needs_review', summary, disclaimer,
  reasons: [{ code, severity: 'incompatible'|'needs_review'|'info', shipmentIds, params, messageKey, message }],
  totals: { weightKg, weightComplete, volumeM3, palletPositions },
  limits: { maxPayloadKg, payloadSource, internalVolumeM3, euroPallets } }
```

**Hard failures (`incompatible`):**

- packaging not catalogued for the cargo
- trailer category or packaging unsuitable
- weight, pallets or volume exceeded
- temperature ranges that don't overlap, or temperature required without control
- different bulk products in one undivided body
- bulk cargo together with packaged cargo

**Review needed (`needs_review`):**

- any missing weight, pallet count or volume
- an unverified trailer limit
- unknown temperature needs
- the same bulk product from several owners
- different hygiene groups
- contamination risks (possibly treated seed, machinery oil, hay or straw dust with fresh produce)
- fire-risk cargo combined with other cargo
- an unknown cargo type

Uncertainty never resolves to `compatible`. Bulk volume is derived from the **lower** density bound, so it errs towards needing more space.

Pass `trailer.overrides` with the real vehicle's `maxPayloadKg`, `internalVolumeM3` and `euroPallets` whenever they are known. This replaces catalog `null`s and is reported as `payloadSource: 'user_provided'`.

`suggestTrailerCategories(shipments)` returns the trailer categories every shipment could use.

## Fuel and transport cost

- `estimateFuel({ distanceKm, consumptionLPer100Km, fuelPriceEurPerLiter })`: 250 km × 30 l/100 km × €1.50 → 75 l, €112.50.
- `estimateRouteDeviationFuel({ additionalDistanceKm, ... })`: 15 km → €6.75.
- `resolveConsumption({ overrideLPer100Km, tractor })`: priority is user override, then model estimate, then the 30 l/100 km demo default. The 21.x test value is returned as `referenceLPer100Km` for display only.
- `estimateTransportOperatingCost({ route, fuel, stopCostEur, tollsEur, vehicleCostPerKmEur, otherExpenses, customerTransportPriceEur })`:
  - Keeps **fuel cost**, **operating cost** and **customer price** apart.
  - Any omitted component is `unknown`: `operatingCost.totalEur` is then `null` and only `knownSubtotalEur` is given. Pass `0` when a cost really does not apply.

Zero distance is accepted by the fuel functions (0 l, €0), so a "no detour" case works. Main-route calculations in the planner reject 0 km.

## Savings and commission

- `calculateSavings({ separateTransportTotalEur, combinedTransportTotalEur, commissionRate = 0.2, savingsBasis = 'estimated', servicesEquivalent = true })`: €360 / €275 / 20 % → €85 gross, €17 fee, €68 net.
  - Fee is 0 when savings ≤ 0 or when the services are not marked equivalent.
  - `commissionRate` must be a fraction in [0, 1). Passing 20 instead of 0.2 is rejected.
- `allocateSharedTransport({ combinedTransportTotalEur, participants: [{ participantId, independentAlternativeEur, weightKg?, tonneKm?, palletPositions? }], method, customShares?, commissionRate })`:
  - **Methods:**
    - `proportional_to_alternative` (default): everyone saves the same percentage, so nobody pays more than their alternative when the group saves.
    - `weight`, `tonne_km`, `pallet_positions`, `equal`, `custom` (shares summing to 1).
  - **Fees:** each participant's fee is charged on **their own** positive savings.
  - **When someone is worse off:** if any participant pays more than their independent alternative, `status = 'not_mutually_beneficial'`, `feesChargeable = false`, all fees are set to 0 (shown as `provisionalPlatformFeeEur`), and a localized note names that participant.
  - **Rounding:** all money is in integer cents, and allocations always sum exactly to the combined total.
  - **Limitations:** no method is universally fair. Weight or equal splits ignore detour distance and timing. The default ties cost to each customer's alternative, which must itself be a realistic quote for an **equivalent** service. Savings are `estimated` until invoices confirm them.

## For Aistis (matching algorithm and architecture)

1. For each candidate group of shipments, call `checkCompatibility()` with the intended trailer and real limits in `overrides`. Use only `compatible` groups automatically; route `needs_review` to a human.
2. Get route figures from the routing layer (see below), compute each shipment's independent alternative and the combined cost with `estimateTransportOperatingCost()`, and pass both to `allocateSharedTransport()`.
3. Display `status`, `reasons[].message` and `notes[].text`. They are already localized (`locale: 'lt'` by default).
4. Catch `LogisticsValidationError` and show `problems[]` (`field`, `code`, `message`).

## For Arnas (navigation / Sygic)

Map provider output to this contract. The calculators never see Sygic- or ORS-specific data:

```js
{
  routeId: 'trip-42',
  distanceKm: 312.4,                 // total driven distance
  durationMinutes: 245,              // null if unknown
  additionalDistanceKm: 15,          // extra km caused by pickups/deliveries (default 0)
  additionalDurationMinutes: 18,
  stops: [{ stopId: 'p1', type: 'pickup', durationMinutes: 20 }],
  source: 'sygic',                   // provider name
  dataStatus: 'provider'             // or 'manual_estimate' | 'demo_sample'
}
```

`normalizeRouteInput()` validates it. `routeInputFromPlannerLeg()` shows an adapter from this app's own `/api/routes` result. Label any sample distances `dataStatus: 'demo_sample'`.

## Localisation

- **IDs:** stable English IDs (`wheat`, `agricultural_tipper`).
- **Names:** display names live in `names: { lt, en }`.
- **Fallback chain:** requested locale, then `lt`, then `en`, then the ID.
- **Message text:** calculation code returns message keys plus parameters. Text comes from `i18n.js`, where every key exists in both languages (enforced by a test).
- **Adding a language:** add `names.<code>` to the JSON and a dictionary in `i18n.js`.
- **Not yet localized:** the catalog's long `notes` fields are English only.

## Still missing / next steps

- Open the cited sources and upgrade the confidence tags. Fill S.KI LIGHT payload and unladen mass from the data sheet PDFs, and the reefer temperature range from the refrigeration unit spec.
- Get the registered payload of the team's actual vehicle combinations to replace the 24 t demo profile.
- Expert or regulatory review of hygiene groups and contamination rules (feed safety / GMP+, seed treatment, previous-cargo rules).
- Add bulk sugar beet, hazardous and ADR cargo (out of MVP scope), and divided or multi-compartment bodies.
- Further tractor models: only add them once figures come from comparable, sourced tests.
