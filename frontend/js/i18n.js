/**
 * Minimal translation layer. Lithuanian is the default UI language; English is
 * the fallback for any missing key. Static markup uses:
 *   data-i18n="key"                      → element.textContent
 *   data-i18n-attr="placeholder:key;..."  → element attributes
 * Adding a language = adding a dictionary below; no other code changes.
 */

const en = {
  'app.subtitle': 'Grain route planner',
  'nav.planner': 'Route planner',
  'nav.freight': 'Freight board',
  'nav.carriers': 'Carriers',
  'nav.shippers': 'Shippers',
  'nav.planned': 'Planned extension — not implemented',
  'status.connecting': 'Connecting…',
  'status.ok': 'API & database OK',
  'status.degraded': 'Database unavailable',
  'status.offline': 'API unreachable',
  'status.routing': 'Routing: {provider}',
  'status.routingCar': 'car profile',
  'status.routingTruck': 'truck profile',
  'status.prototype': 'Local prototype',
  'status.prototypeTitle': 'No authentication is implemented. Do not expose this server publicly.',
  'settings.label': 'Account and settings (planned)',
  'lang.label': 'Language',
  'skip': 'Skip to planner',

  'form.assumptionNote': 'Default values are editable demo assumptions — not market prices or vehicle specifications.',
  'route.title': 'Route',
  'route.origin': 'Starting location',
  'route.destination': 'Destination',
  'route.originPlaceholder': 'e.g. Panevėžys',
  'route.destinationPlaceholder': 'e.g. Klaipėda port',
  'route.pickOnMap': 'Pick on map',
  'route.pickingHint': 'Click on the map to set the {field}. Press Esc to cancel.',
  'route.swap': '⇅ Swap',
  'route.quickFill': 'Quick fill:',
  'route.returnTrip': 'Return trip',
  'route.returnNone': 'One way',
  'route.returnEmpty': 'Return empty',
  'route.returnLoaded': 'Return loaded',
  'route.returnCargo': 'Return cargo',
  'route.droppedPin': 'Map point {lat}, {lon}',
  'geo.searching': 'Searching…',
  'geo.noResults': 'No places found.',
  'geo.error': 'Search failed: {message}',
  'geo.pressEnter': 'Press Enter to search.',

  'truck.title': 'Truck configuration',
  'truck.preset': 'Configuration preset',
  'truck.presetHint': 'A preset fills the fields below; every value stays editable.',
  'truck.custom': 'Custom (keep my values)',
  'truck.type': 'Truck type',
  'truck.type.tractor_semitrailer': 'Tractor + semitrailer',
  'truck.type.rigid_drawbar': 'Rigid + drawbar trailer',
  'truck.type.rigid': 'Rigid truck',
  'truck.fuelType': 'Fuel type',
  'fuel.diesel': 'Diesel',
  'fuel.hvo': 'HVO',
  'fuel.biodiesel': 'Biodiesel',
  'fuel.lng': 'LNG',
  'fuel.cng': 'CNG',
  'truck.capacity': 'Max cargo payload',
  'truck.volume': 'Body volume',
  'truck.consumption': 'Consumption loaded',
  'truck.consumptionEmpty': 'Consumption empty',
  'truck.dimensions': 'Vehicle dimensions & weights',
  'truck.height': 'Height',
  'truck.width': 'Width',
  'truck.length': 'Length',
  'truck.grossWeight': 'Gross weight',
  'truck.axleLoad': 'Axle load',
  'truck.restrictionsOn': 'used for routing',
  'truck.restrictionsOff': 'not used by router',
  'truck.restrictionsHintOn': 'The truck routing profile avoids roads whose OpenStreetMap restrictions conflict with these values.',
  'truck.restrictionsHintOff': 'The configured routing provider uses a car profile and cannot apply truck restrictions. Values are stored with the calculation only.',

  'cargo.title': 'Cargo',
  'cargo.type': 'Grain type',
  'cargo.quantity': 'Quantity',
  'cargo.density': 'Bulk density',
  'cargo.optional': 'optional',
  'cargo.densityHint': 'Optional. Used only for the body-volume estimate. Leave empty or 0 for no estimate; enter t/m³ to estimate volume.',
  'cargo.capacityText': '{pct}% · {qty} of {cap} kg',
  'cargo.capacityOver': 'Exceeds the payload by {over} kg',

  'fuel.title': 'Fuel',
  'fuel.price': 'Fuel price',
  'fuel.priceHint': 'Demo value. Enter your actual purchase price.',

  'costs.title': 'Additional costs',
  'costs.hint': 'Enter your own figures. The app does not estimate tolls or other operating costs. Driver expenses are not included.',
  'costs.tolls': 'Tolls (outbound)',
  'costs.returnTolls': 'Tolls (return)',
  'costs.loading': 'Loading / unloading',
  'costs.other': 'Other operating costs',

  'action.calculate': 'Calculate route & costs',
  'action.calculating': 'Calculating…',
  'action.save': 'Save calculation',
  'action.saving': 'Saving…',
  'action.open': 'Open',
  'action.delete': 'Delete',
  'action.cancel': 'Cancel',
  'action.retry': 'Retry',
  'action.newer': '‹ Newer',
  'action.older': 'Older ›',

  'map.label': 'Interactive map. Use arrow keys to pan and plus/minus to zoom.',
  'map.loading': 'Requesting route…',
  'map.origin': 'Start',
  'map.destination': 'Destination',
  'map.outbound': 'Outbound',
  'map.return': 'Return',

  'tabs.results': 'Results',
  'tabs.history': 'Saved calculations',
  'tabs.activity': 'Activity',

  'results.emptyTitle': 'No calculation yet',
  'results.emptyText': 'Choose a start and destination, check the truck and cargo values, then press “Calculate route & costs”.',
  'results.distance': 'Distance',
  'results.duration': 'Driving time',
  'results.durationCar': 'car-profile estimate',
  'results.durationTruck': 'HGV-profile estimate',
  'results.durationUnavailable': 'not supplied',
  'results.fuel': 'Fuel used',
  'results.fuelCost': 'Fuel cost',
  'results.total': 'Total estimated cost',
  'results.perTonne': 'Cost per tonne',
  'results.perTonneKm': 'Cost per tonne-km',
  'results.utilization': 'Payload utilisation',
  'results.volume': 'Volume utilisation',
  'results.returnLeg': 'incl. return ({mode})',
  'results.legs': 'Legs',
  'results.leg': 'Leg',
  'results.leg.outbound': 'Outbound',
  'results.leg.return': 'Return',
  'results.loaded': 'loaded',
  'results.empty': 'empty',
  'results.breakdown': 'Cost breakdown',
  'results.item': 'Item',
  'results.source': 'Source',
  'results.amount': 'Amount',
  'results.totalRow': 'Total estimated operating cost',
  'results.notices': 'Warnings & assumptions',
  'results.routeVia': '{provider} · {profile}',
  'results.saveLabel': 'Label (optional)',
  'results.savePlaceholder': 'e.g. Wheat to Klaipėda, Monday',
  'results.saved': 'Saved calculation from {date}',
  'results.savedNote': 'Figures below are the saved values. The route line was fetched again for display only.',
  'results.routeChanged': 'The provider now returns {now} for this route; the saved calculation used {then}.',
  'results.routeRefetchFailed': 'Saved figures are shown, but the route line could not be loaded: {message}',
  'results.disclaimer': 'Estimate only. Not a freight quote and not a carrier price.',
  'results.mapNoticeCar': 'Car routing — not checked against truck restrictions.',

  'source.user_input': 'Your input',
  'source.routing_provider': 'Routing provider',
  'source.calculated': 'Calculated',
  'source.default_assumption': 'Default assumption',

  'cost.fuel': 'Fuel',
  'cost.tolls': 'Tolls / road charges (outbound)',
  'cost.returnTolls': 'Tolls / road charges (return)',
  'cost.loadingUnloading': 'Loading / unloading',
  'cost.other': 'Other operating costs',

  'history.emptyTitle': 'No saved calculations',
  'history.emptyText': 'Calculations you save are stored in PostgreSQL and remain available after a restart.',
  'history.confirmTitle': 'Delete saved calculation?',
  'history.confirmText': 'This permanently removes “{name}” from the database.',
  'history.total': '{count} saved',
  'history.deleted': 'Calculation deleted.',
  'history.savedToast': 'Calculation saved.',
  'activity.empty': 'No activity recorded yet.',

  'error.network': 'The server could not be reached. Is it running?',
  'error.generic': 'Something went wrong: {message}',
  'error.fixFields': 'Please correct the highlighted fields.',
  'error.loadReference': 'Could not load truck and cargo data: {message}',

  'validation.required': 'Required.',
  'validation.positive': 'Must be greater than 0.',
  'validation.nonNegative': 'Must be 0 or greater.',
  'validation.max': 'Must not exceed {max}.',
  'validation.selectLocation': 'Choose a place from the suggestions or pick it on the map.',
  'validation.sameLocation': 'Start and destination must be different.',
  'validation.overCapacity': 'Exceeds the truck payload ({cap} kg).',

  'app.name': 'HaulPair',
  'nav.myCalculations': 'My calculations',
  'status.accessOn': 'Access protected',
  'status.accessOff': 'Shared prototype',
  'cargo.quantityKg': 'Quantity, kg',
  'cargo.returnCargoKg': 'Return cargo, kg',
  'cargo.densityLabel': 'Bulk density, t/m³',
  'cargo.tEquiv': '≈ {t} t',
  'results.fullLoad': 'Full load',
  'results.volumeNeedsDensity': 'The volume estimate needs a positive bulk density (t/m³) and a body volume.',
  'results.volumeUnknown': 'Volume estimate needs a bulk density.',
  'results.fuelPriceOrigin': 'Fuel price source',
  'tabs.costs': 'Costs',
  'fuel.priceLabel': 'Fuel price, €/l',
  'fuel.originManual': 'Your price',
  'fuel.originSuggested': 'Price per {source} · data {date}',
  'fuel.useSuggested': 'Use suggested price',
  'fuel.suggestedBadge': 'Suggested price',
  'fuel.suggestionUnavailable': 'Automatic fuel price is currently unavailable. Enter your own price.',
  'fuel.suggestionStale': 'Could not update — showing {date}.',
  'fuel.suggestionLoading': 'Checking source…',
  'fuel.recalcNeeded': 'Inputs changed — recalculate to update the result.',
  'ai.title': 'Describe your shipment (AI)',
  'ai.hint': 'Type the route and cargo in your own words; AI prepares a suggestion you review and apply. Nothing is calculated or saved automatically.',
  'ai.placeholder': 'e.g. 22 t of wheat from Panevėžys to Klaipėda, bulk density 0.72 t/m³',
  'ai.prepare': 'Prepare form with AI',
  'ai.preparing': 'Preparing…',
  'ai.apply': 'Apply to form',
  'ai.applied': 'Suggestion applied — review and calculate.',
  'ai.unavailable': 'AI is currently unavailable. Fill the form manually.',
  'ai.disabledHint': 'AI help is off until the owner configures an API key.',
  'ai.missing': 'Still needed: {fields}',
  'ai.notes': 'Note',
  'ai.field.origin': 'From',
  'ai.field.destination': 'To',
  'ai.field.grainType': 'Grain',
  'ai.field.quantityKg': 'Quantity',
  'ai.field.densityTPerM3': 'Density',
  'ai.field.return': 'Return',
  'ai.confirmLocations': 'Confirm the suggested places via the search field or by picking them on the map.',
  'validation.selectCargo': 'Choose a grain type.',
  'apierror.NO_ROUTE': 'No drivable route was found between the selected locations.',
  'apierror.UPSTREAM_UNREACHABLE': 'The routing service could not be reached. Try again shortly.',
  'apierror.UPSTREAM_TIMEOUT': 'The routing service did not respond in time. Try again.',
  'apierror.UPSTREAM_RATE_LIMITED': 'The routing service is busy. Wait a moment and try again.',
  'apierror.UPSTREAM_AUTH': 'The routing service rejected the server key. Contact the administrator.',
  'apierror.UPSTREAM_ERROR': 'The routing service returned an error. Try again.',
  'apierror.EXTERNAL_LIMIT': 'The shared daily limit for external requests was reached. Try again later.',
  'apierror.DATABASE_ERROR': 'The database is unavailable. Try again shortly.',
  'apierror.RATE_LIMITED': 'Too many requests. Please slow down.',
  'apierror.UNAUTHORIZED': 'Authentication is required.',
  'apierror.CSRF_BLOCKED': 'The request was blocked for security. Reload the page.',
};

const lt = {
  'app.subtitle': 'Grūdų maršrutų planavimas',
  'nav.planner': 'Maršruto planavimas',
  'nav.freight': 'Krovinių birža',
  'nav.carriers': 'Vežėjai',
  'nav.shippers': 'Siuntėjai',
  'nav.planned': 'Planuojama funkcija — dar neįgyvendinta',
  'status.connecting': 'Jungiamasi…',
  'status.ok': 'API ir duomenų bazė veikia',
  'status.degraded': 'Duomenų bazė nepasiekiama',
  'status.offline': 'API nepasiekiama',
  'status.routing': 'Maršrutai: {provider}',
  'status.routingCar': 'lengvojo automobilio profilis',
  'status.routingTruck': 'sunkvežimio profilis',
  'status.prototype': 'Vietinis prototipas',
  'status.prototypeTitle': 'Autentifikavimas neįgyvendintas. Neskelbkite šio serverio viešai.',
  'settings.label': 'Paskyra ir nustatymai (planuojama)',
  'lang.label': 'Kalba',
  'skip': 'Pereiti prie planavimo',

  'form.assumptionNote': 'Numatytosios reikšmės — redaguojamos demonstracinės prielaidos, o ne rinkos kainos ar transporto priemonių specifikacijos.',
  'route.title': 'Maršrutas',
  'route.origin': 'Pradžios vieta',
  'route.destination': 'Paskirties vieta',
  'route.originPlaceholder': 'pvz. Panevėžys',
  'route.destinationPlaceholder': 'pvz. Klaipėdos uostas',
  'route.pickOnMap': 'Pasirinkti žemėlapyje',
  'route.pickingHint': 'Spustelėkite žemėlapyje, kad nustatytumėte: {field}. Esc — atšaukti.',
  'route.swap': '⇅ Sukeisti',
  'route.quickFill': 'Greitas pasirinkimas:',
  'route.returnTrip': 'Grįžtamasis reisas',
  'route.returnNone': 'Į vieną pusę',
  'route.returnEmpty': 'Grįžta tuščias',
  'route.returnLoaded': 'Grįžta su kroviniu',
  'route.returnCargo': 'Grįžtamasis krovinys',
  'route.droppedPin': 'Taškas žemėlapyje {lat}, {lon}',
  'geo.searching': 'Ieškoma…',
  'geo.noResults': 'Vietų nerasta.',
  'geo.error': 'Paieška nepavyko: {message}',
  'geo.pressEnter': 'Paspauskite Enter, kad ieškotumėte.',

  'truck.title': 'Sunkvežimio konfigūracija',
  'truck.preset': 'Konfigūracijos šablonas',
  'truck.presetHint': 'Šablonas užpildo laukus žemiau; visas reikšmes galima keisti.',
  'truck.custom': 'Pasirinktinė (palikti mano reikšmes)',
  'truck.type': 'Sunkvežimio tipas',
  'truck.type.tractor_semitrailer': 'Vilkikas su puspriekabe',
  'truck.type.rigid_drawbar': 'Sunkvežimis su priekaba',
  'truck.type.rigid': 'Sunkvežimis be priekabos',
  'truck.fuelType': 'Kuro rūšis',
  'fuel.diesel': 'Dyzelinas',
  'fuel.hvo': 'HVO',
  'fuel.biodiesel': 'Biodyzelinas',
  'fuel.lng': 'SGD (LNG)',
  'fuel.cng': 'SGD (CNG)',
  'truck.capacity': 'Didž. krovinio masė',
  'truck.volume': 'Kėbulo tūris',
  'truck.consumption': 'Sąnaudos su kroviniu',
  'truck.consumptionEmpty': 'Sąnaudos tuščiam',
  'truck.dimensions': 'Matmenys ir masės',
  'truck.height': 'Aukštis',
  'truck.width': 'Plotis',
  'truck.length': 'Ilgis',
  'truck.grossWeight': 'Bendroji masė',
  'truck.axleLoad': 'Ašies apkrova',
  'truck.restrictionsOn': 'naudojama maršrutui',
  'truck.restrictionsOff': 'maršrutui nenaudojama',
  'truck.restrictionsHintOn': 'Sunkvežimių maršruto profilis vengia kelių, kurių OpenStreetMap apribojimai prieštarauja šioms reikšmėms.',
  'truck.restrictionsHintOff': 'Nustatytas maršrutų teikėjas naudoja lengvojo automobilio profilį ir negali taikyti sunkvežimių apribojimų. Reikšmės tik išsaugomos su skaičiavimu.',

  'cargo.title': 'Krovinys',
  'cargo.type': 'Grūdų rūšis',
  'cargo.quantity': 'Kiekis',
  'cargo.density': 'Piltinis tankis',
  'cargo.optional': 'neprivaloma',
  'cargo.densityHint': 'Neprivaloma. Naudojama tik kėbulo tūrio įverčiui. Tuščia arba 0 – tūris neskaičiuojamas; įveskite t/m³, kad apskaičiuotų tūrį.',
  'cargo.capacityText': '{pct}% · {qty} iš {cap} kg',
  'cargo.capacityOver': 'Viršija leistiną krovinio masę {over} kg',

  'fuel.title': 'Kuras',
  'fuel.price': 'Kuro kaina',
  'fuel.priceHint': 'Demonstracinė reikšmė. Įveskite faktinę pirkimo kainą.',

  'costs.title': 'Papildomos išlaidos',
  'costs.hint': 'Įveskite savo duomenis. Programa nevertina kelių mokesčių ar kitų išlaidų. Vairuotojo išlaidos neįtraukiamos.',
  'costs.tolls': 'Kelių mokesčiai (pirmyn)',
  'costs.returnTolls': 'Kelių mokesčiai (atgal)',
  'costs.loading': 'Pakrovimas / iškrovimas',
  'costs.other': 'Kitos eksploatacinės išlaidos',

  'action.calculate': 'Skaičiuoti maršrutą ir kainą',
  'action.calculating': 'Skaičiuojama…',
  'action.save': 'Išsaugoti skaičiavimą',
  'action.saving': 'Saugoma…',
  'action.open': 'Atidaryti',
  'action.delete': 'Ištrinti',
  'action.cancel': 'Atšaukti',
  'action.retry': 'Bandyti dar kartą',
  'action.newer': '‹ Naujesni',
  'action.older': 'Senesni ›',

  'map.label': 'Interaktyvus žemėlapis. Rodyklėmis — slinkti, pliusu/minusu — keisti mastelį.',
  'map.loading': 'Gaunamas maršrutas…',
  'map.origin': 'Pradžia',
  'map.destination': 'Paskirtis',
  'map.outbound': 'Pirmyn',
  'map.return': 'Atgal',

  'tabs.results': 'Rezultatai',
  'tabs.history': 'Išsaugoti skaičiavimai',
  'tabs.activity': 'Veiklos žurnalas',

  'results.emptyTitle': 'Skaičiavimų dar nėra',
  'results.emptyText': 'Pasirinkite pradžios ir paskirties vietas, patikrinkite sunkvežimio ir krovinio duomenis ir spauskite „Skaičiuoti maršrutą ir kainą“.',
  'results.distance': 'Atstumas',
  'results.duration': 'Važiavimo laikas',
  'results.durationCar': 'lengvojo automobilio įvertis',
  'results.durationTruck': 'sunkvežimio profilio įvertis',
  'results.durationUnavailable': 'nepateikta',
  'results.fuel': 'Sunaudota kuro',
  'results.fuelCost': 'Kuro kaina',
  'results.total': 'Bendra numatoma kaina',
  'results.perTonne': 'Kaina už toną',
  'results.perTonneKm': 'Kaina už tonkilometrį',
  'results.utilization': 'Krovinio masės išnaudojimas',
  'results.volume': 'Tūrio išnaudojimas',
  'results.returnLeg': 'įsk. grįžimą ({mode})',
  'results.legs': 'Maršruto dalys',
  'results.leg': 'Dalis',
  'results.leg.outbound': 'Pirmyn',
  'results.leg.return': 'Atgal',
  'results.loaded': 'su kroviniu',
  'results.empty': 'tuščias',
  'results.breakdown': 'Išlaidų struktūra',
  'results.item': 'Straipsnis',
  'results.source': 'Šaltinis',
  'results.amount': 'Suma',
  'results.totalRow': 'Bendros numatomos eksploatacinės išlaidos',
  'results.notices': 'Įspėjimai ir prielaidos',
  'results.routeVia': '{provider} · {profile}',
  'results.saveLabel': 'Pavadinimas (neprivaloma)',
  'results.savePlaceholder': 'pvz. Kviečiai į Klaipėdą, pirmadienis',
  'results.saved': 'Išsaugotas skaičiavimas, {date}',
  'results.savedNote': 'Rodomos išsaugotos reikšmės. Maršruto linija gauta iš naujo tik atvaizdavimui.',
  'results.routeChanged': 'Teikėjas dabar šiam maršrutui grąžina {now}; išsaugotame skaičiavime naudota {then}.',
  'results.routeRefetchFailed': 'Rodomos išsaugotos reikšmės, bet maršruto linijos įkelti nepavyko: {message}',
  'results.disclaimer': 'Tik įvertis. Tai nėra krovinio pervežimo pasiūlymas ar vežėjo kaina.',
  'results.mapNoticeCar': 'Lengvojo automobilio maršrutas — netikrintas pagal sunkvežimių apribojimus.',

  'source.user_input': 'Jūsų įvestis',
  'source.routing_provider': 'Maršrutų teikėjas',
  'source.calculated': 'Apskaičiuota',
  'source.default_assumption': 'Numatytoji prielaida',

  'cost.fuel': 'Kuras',
  'cost.tolls': 'Kelių mokesčiai (pirmyn)',
  'cost.returnTolls': 'Kelių mokesčiai (atgal)',
  'cost.loadingUnloading': 'Pakrovimas / iškrovimas',
  'cost.other': 'Kitos eksploatacinės išlaidos',

  'history.emptyTitle': 'Išsaugotų skaičiavimų nėra',
  'history.emptyText': 'Išsaugoti skaičiavimai laikomi PostgreSQL duomenų bazėje ir išlieka po paleidimo iš naujo.',
  'history.confirmTitle': 'Ištrinti išsaugotą skaičiavimą?',
  'history.confirmText': 'Skaičiavimas „{name}“ bus negrįžtamai pašalintas iš duomenų bazės.',
  'history.total': 'Išsaugota: {count}',
  'history.deleted': 'Skaičiavimas ištrintas.',
  'history.savedToast': 'Skaičiavimas išsaugotas.',
  'activity.empty': 'Veiklos įrašų dar nėra.',

  'error.network': 'Nepavyko pasiekti serverio. Ar jis paleistas?',
  'error.generic': 'Įvyko klaida: {message}',
  'error.fixFields': 'Pataisykite pažymėtus laukus.',
  'error.loadReference': 'Nepavyko įkelti sunkvežimių ir krovinių duomenų: {message}',

  'validation.required': 'Privaloma.',
  'validation.positive': 'Turi būti didesnis už 0.',
  'validation.nonNegative': 'Turi būti 0 arba daugiau.',
  'validation.max': 'Negali viršyti {max}.',
  'validation.selectLocation': 'Pasirinkite vietą iš pasiūlymų arba pažymėkite žemėlapyje.',
  'validation.sameLocation': 'Pradžios ir paskirties vietos turi skirtis.',
  'validation.overCapacity': 'Viršija sunkvežimio krovinio masę ({cap} kg).',

  'app.name': 'HaulPair',
  'nav.myCalculations': 'Mano skaičiavimai',
  'status.accessOn': 'Prieiga apsaugota',
  'status.accessOff': 'Bendras prototipas',
  'cargo.quantityKg': 'Kiekis, kg',
  'cargo.returnCargoKg': 'Grįžtamasis krovinys, kg',
  'cargo.densityLabel': 'Piltinis tankis, t/m³',
  'cargo.tEquiv': '≈ {t} t',
  'results.fullLoad': 'Pilnas krovinys',
  'results.volumeNeedsDensity': 'Tūrio įverčiui reikia teigiamo piltinio tankio (t/m³) ir kėbulo tūrio.',
  'results.volumeUnknown': 'Tūrio įverčiui reikia piltinio tankio.',
  'results.fuelPriceOrigin': 'Kuro kainos šaltinis',
  'tabs.costs': 'Išlaidos',
  'fuel.priceLabel': 'Kuro kaina, €/l',
  'fuel.originManual': 'Jūsų kaina',
  'fuel.originSuggested': 'Kaina pagal {source} · duomenys {date}',
  'fuel.useSuggested': 'Naudoti siūlomą kainą',
  'fuel.suggestedBadge': 'Siūloma kaina',
  'fuel.suggestionUnavailable': 'Automatinė kuro kaina šiuo metu nepasiekiama. Įveskite savo kainą.',
  'fuel.suggestionStale': 'Nepavyko atnaujinti — rodoma {date}.',
  'fuel.suggestionLoading': 'Tikrinamas šaltinis…',
  'fuel.recalcNeeded': 'Įvesties duomenys pasikeitė — perskaičiuokite, kad atnaujintumėte rezultatą.',
  'ai.title': 'Aprašyk krovinį (DI)',
  'ai.hint': 'Įrašykite maršrutą ir krovinį savais žodžiais; DI paruoš pasiūlymą, kurį peržiūrite ir pritaikote. Niekas automatiškai neskaičiuojama ir neišsaugoma.',
  'ai.placeholder': 'pvz. 22 t kviečių iš Panevėžio į Klaipėdą, piltinis tankis 0,72 t/m³',
  'ai.prepare': 'Paruošti formą su DI',
  'ai.preparing': 'Ruošiama…',
  'ai.apply': 'Pritaikyti formai',
  'ai.applied': 'Pasiūlymas pritaikytas — peržiūrėkite ir skaičiuokite.',
  'ai.unavailable': 'DI šiuo metu nepasiekiamas. Užpildykite formą rankiniu būdu.',
  'ai.disabledHint': 'DI pagalba išjungta, kol savininkas nesukonfigūruos API rakto.',
  'ai.missing': 'Dar reikia: {fields}',
  'ai.notes': 'Pastaba',
  'ai.field.origin': 'Iš',
  'ai.field.destination': 'Į',
  'ai.field.grainType': 'Grūdai',
  'ai.field.quantityKg': 'Kiekis',
  'ai.field.densityTPerM3': 'Tankis',
  'ai.field.return': 'Grįžimas',
  'ai.confirmLocations': 'Patvirtinkite siūlomas vietas per paieškos lauką arba pažymėdami jas žemėlapyje.',
  'validation.selectCargo': 'Pasirinkite grūdų rūšį.',
  'apierror.NO_ROUTE': 'Tarp pasirinktų vietų nerasta pravažiuojamo maršruto.',
  'apierror.UPSTREAM_UNREACHABLE': 'Nepavyko pasiekti maršrutų paslaugos. Bandykite netrukus dar kartą.',
  'apierror.UPSTREAM_TIMEOUT': 'Maršrutų paslauga neatsakė laiku. Bandykite dar kartą.',
  'apierror.UPSTREAM_RATE_LIMITED': 'Maršrutų paslauga užimta. Palaukite ir bandykite dar kartą.',
  'apierror.UPSTREAM_AUTH': 'Maršrutų paslauga atmetė serverio raktą. Kreipkitės į administratorių.',
  'apierror.UPSTREAM_ERROR': 'Maršrutų paslauga grąžino klaidą. Bandykite dar kartą.',
  'apierror.EXTERNAL_LIMIT': 'Pasiekta bendra dienos išorinių užklausų riba. Bandykite vėliau.',
  'apierror.DATABASE_ERROR': 'Duomenų bazė nepasiekiama. Bandykite netrukus dar kartą.',
  'apierror.RATE_LIMITED': 'Per daug užklausų. Sulėtinkite tempą.',
  'apierror.UNAUTHORIZED': 'Reikalingas prisijungimas.',
  'apierror.CSRF_BLOCKED': 'Užklausa užblokuota dėl saugumo. Perkraukite puslapį.',
};

export const DICTIONARIES = { lt, en };
export const SUPPORTED_LOCALES = ['lt', 'en'];
export const DEFAULT_LOCALE = 'lt';
export const FALLBACK_LOCALE = 'en';
const INTL_LOCALES = { lt: 'lt-LT', en: 'en-GB' };
const STORAGE_KEY = 'vilkasia.locale';

let current = DEFAULT_LOCALE;
const listeners = new Set();

function readStoredLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LOCALES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function initLocale() {
  current = readStoredLocale() ?? DEFAULT_LOCALE;
  document.documentElement.lang = current;
  return current;
}

export function getLocale() {
  return current;
}

export function intlLocale() {
  return INTL_LOCALES[current] ?? INTL_LOCALES[FALLBACK_LOCALE];
}

export function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  current = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page view only.
  }
  applyTranslations();
  listeners.forEach((fn) => fn(locale));
}

export function onLocaleChange(fn) {
  listeners.add(fn);
}

/** Translate a key with {placeholders}. Falls back to English, then to the key itself. */
export function t(key, vars = {}) {
  const template = DICTIONARIES[current]?.[key] ?? DICTIONARIES[FALLBACK_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : `{${name}}`));
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

// ---------- Locale-aware formatting ----------
export const fmt = {
  currency(value, { decimals = 2 } = {}) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat(intlLocale(), {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  },
  number(value, decimals = 1) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  },
  unit(value, unit, decimals = 1) {
    return value === null || value === undefined ? '—' : `${fmt.number(value, decimals)} ${unit}`;
  },
  duration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const totalMin = Math.round(seconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return current === 'lt' ? `${h} val. ${m} min.` : `${h} h ${m} min`;
  },
  dateTime(iso) {
    return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  },
};
