# HaulPair V3 — pakeitimų sąrašas, patikros ir diegimas

Darbinis pavadinimas pakeistas į **HaulPair** (tik matomas prekės ženklas; duomenų
schemos, įrašai ir API sutartys nekeisti). Keista tik tai, kas būtina reikalavimams
įgyvendinti. Nepakeisti failai neperrašyti.

**Patikra:** 154 automatiniai testai praeina (unit + API + integraciniai su tikra
PostgreSQL). Naršyklės srautas (kg, tankis, DI pasiūlymas, LEA kaina, LT/EN,
mobilus) patikrintas „Playwright" su realia DB; DI ir mokami kvietimai visada
imituojami — tikrų mokamų užklausų nedaryta. Ko šiame konteineryje patikrinti
nepavyko: gyvų OSRM/ORS/Photon/žemėlapio plytelių, tikros Gemini užklausos ir
tikro LEA failo gavimo (tinklas blokuotas) — tai pažymėta žemiau.

---

## 1. Sauga (prieš viešą naudojimą)

- **Prieigos apsauga (HTTP Basic, bendra):** `AUTH_ENABLED`, `AUTH_USERNAME`,
  `AUTH_PASSWORD` (tik serverio aplinkoje). **Produkcijoje privaloma** — be
  paslapčių programa viešai nepasileidžia. Apsaugotas visas turinys ir API
  (skaitymas, trynimas, `/routes`, `/geocode`, `/ai/*`, `/calculations/*`,
  žurnalas). Vieša liko tik minimali `GET /api/health` būsena. Slaptažodžiai
  lyginami pastoviu laiku, nerodomi klaidose/žurnaluose, auth bandymai ribojami.
  *Riba:* bendra prieiga neatskiria bandytojų duomenų (dokumentuota).
- **CSRF:** būseną keičiančioms `/api` užklausoms reikalaujama to paties kilmės
  signalo (`Sec-Fetch-Site` arba `X-Requested-With`) — apsauga nuo pakartotinio
  kredencialų panaudojimo iš svetimos svetainės (ne vien CORS).
- **Tarpinis serveris:** `TRUST_PROXY` dokumentuotas (Render = `true`, vienas
  „hop"); nebepasikliaujama visais `X-Forwarded-For`.
- **Bendras išorinių kvietimų stabdis:** `EXTERNAL_DAILY_MAX` (dienos) +
  `EXTERNAL_MAX_CONCURRENT` (vienalaikių) visiems tiekėjų kvietimams, be mokamo
  kvietimo pasiekus ribą. *Riba:* skaitiklis procese (vienam egzemplioriui;
  keliems reikia bendros saugyklos).
- Paslaptys lieka serveryje; `/api/config` jų neatskleidžia. Parametrizuotas SQL,
  žurnalų maskavimas, saugūs klaidų atsakymai, užklausos dydžio riba, HMAC žetonai
  ir CSP išlaikyti; CSP neatlaisvinta.
- **Nauji saugumo testai:** be auth negalima skaityti/kurti/trinti/maršrutizuoti/
  geokoduoti; teisinga auth veikia; CSRF blokuoja; pasiekus dienos ribą tiekėjas
  nekviečiamas; paslaptys neatskleidžiamos.

## 2. Kilogramai

- Pagrindinio ir grįžtamojo krovinio kiekis įvedamas **kg** („Kiekis, kg" /
  „Grįžtamasis krovinys, kg"); greta rodomas „≈ t" atitikmuo ir „91,7 % · 22 000
  iš 24 000 kg". €/t ir €/tkm **nepakeisti**. Konversija kg→t (÷1000) atliekama
  **tik priekinės dalies riboje**; API/DB schema ir seni įrašai nekeisti → jokios
  nereikalingos migracijos. Seni įrašai atsidaro ir persiskaičiuoja teisingai
  (tos pačios fizinės masės rodikliai sutampa su ankstesniu „t" skaičiavimu).

## 3. Neprivalomas piltinis tankis (0 leidžiamas)

- Laukas „Piltinis tankis, t/m³ (neprivaloma)". Tuščia → `null`; aiškus `0` →
  saugomas `0`; neigiama/netinkama → klaida. **Panaikintas tylus tankio
  priskyrimas pagal grūdų rūšį** (tipinė reikšmė rodoma tik kaip vietaženklė
  užuomina). Skaičiuojant/saugant tankio **nereikalaujama**; **niekada
  nedalijama iš 0** — kai tankio nėra/0 (ar nėra kėbulo tūrio), tūrio rodiklis
  lieka „—" su paaiškinimu, be NaN/Infinity.
- Migracija `003_optional_density.sql` (DB apribojimas `>= 0` arba `NULL`).

## 4. Dizainas (HaulPair)

- Išlaikyta originali struktūra: forma kairėje, didelis žemėlapis viršuje
  dešinėje, rezultatai po juo. Nauja paletė (fonas `#F5F5F0`, žalia `#204D3B`,
  santūrus auksas), aiški hierarchija — **bendra suma ryškiausia**, greta €/t ir
  €/tkm; kiti rodikliai kompaktiškame tinklelyje. Visi rodikliai ir laukai
  išsaugoti; transporto ir išlaidų sekcijos sulankstomos su santraukomis.
  Vieningos kontūrinės ikonos (be emoji). Skirtukai: **Rezultatai / Išlaidos /
  Išsaugoti skaičiavimai / Veiklos žurnalas**. „Pilnas krovinys" ties 100 %.
  Masės ir tūrio išnaudojimas atskiri.
- Telefone žemėlapis virš formos, aukštis ~210 px; be horizontalaus slinkimo;
  16 px įvesties šriftas, ~44 px palietimo sritys. Patikrinta 360–390 px, 768 px,
  1280×720, 1440×900.
- Lokalizuoti **dinaminiai** tekstai: grūdų pavadinimai istorijoje (pvz.
  „Kviečiai"), serverio klaidų kodai (NO_ROUTE, UPSTREAM_*, limitai) LT/EN.
  *Riba:* maršruto/skaičiavimo laisvo teksto perspėjimai dar anglų kalba
  (perkėlimas į kodus — tolesnis darbas).

## 5. DI „Aprašyk krovinį" — tik Google Gemini (numatyta IŠJUNGTA)

- Tikra Gemini integracija (`geminiClient.js`): `POST
  .../v1beta/models/{model}:generateContent`, JSON atsakymas, laukimo laikas,
  stabilūs klaidų kodai. Tiekėją/raktą nustato administratorius serveryje
  (`GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_ENABLED`); **viešoje formoje rakto lauko
  nėra**. Raktas lieka serveryje (ne naršyklėje, ne `/api/config`, ne žurnaluose).
- Funkcija: naudotojas aprašo krovinį → `POST /api/ai/parse-shipment` grąžina
  **pasiūlymą** (vietos tekstu, grūdai, kiekis kg, tankis t/m³ su leistinu 0,
  grįžimas) → naudotojas peržiūri → **„Pritaikyti formai"** perkelia į laukus.
  Niekas automatiškai neskaičiuojama/neišsaugoma; vietas patvirtina per esamą
  geokodavimą (koordinatės neišgalvojamos). Atsakymas validuojamas serveryje.
- **0 € biudžetas:** numatyta `AI_ENABLED=false`; be rakto/kvotos/prie klaidos
  rodoma „DI šiuo metu nepasiekiamas. Užpildykite formą rankiniu būdu." (LT/EN),
  visa kita veikia. Jokio mokamo plano, auto-papildymo ar perjungimo į kitą
  tiekėją. Įvesties ilgio riba (2000), dienos riba (`AI_DAILY_MAX`=50), užklausų
  ribojimas ir laukimo laikas. Išjungus — jokių kvietimų tiekėjui.
- **Prieš aktyvuojant** patikrink nemokamos kvotos tinkamumą ir Google sąlygas ES
  naudotojams — žr. `docs/ai-gemini-setup.md`. Raktas pats savaime **nėra**
  nemokamo naudojimo įrodymas; jei reikia mokamo plano — palik DI išjungtą.
- Testai naudoja **imituotą** Gemini atsakymą (mokamų kvietimų nedaroma).

## 6. LEA kuro kaina (nepriklausoma nuo DI)

- Bendra serverio saugykla (`fuel_prices`, migracija `004`), vienas skaičiavimui
  taikomas kuro kainos įrašas su kilme: EUR/l, kainos data, šaltinis (LEA),
  nuoroda, PVM/pagrindo tekstas, gavimo laikas. `GET /api/fuel-price` skaito
  bendrą įrašą (jokio išorinio kvietimo kiekvienam lankytojui).
- UI: viena kuro kaina su aiškia kilme — **„Jūsų kaina"** (rankinė) arba **„Kaina
  pagal LEA · duomenys [data]"** su veiksmu **„Naudoti siūlomą kainą"**. Rankinis
  įvedimas visada veikia; pakeitus kuro rūšį kaina tyliai neperkeliama. Kuro
  kainos kilmė ir data **įrašoma į išsaugotą skaičiavimą** (atidarius seną įrašą
  rodoma tada naudota kaina, ne šiandienos).
- Administratoriaus importas `POST /api/fuel-price/import` (apsaugotas
  `FUEL_PRICE_ADMIN_TOKEN`) su vienetų normalizavimu (EUR/1000 l, ct/l → EUR/l,
  dešimtainis kablelys), senumo būsena. **Automatinis LEA nuskaitymas
  nepatvirtintas ir nepristatomas kaip veikiantis** (adapteris su SSRF apsauga
  paliktas išjungtas; tikslus failo/API kelias ir ES sąlygos tikrintini diegiant).
  Nepalaikomai kuro rūšiai dyzelino kaina neperkeliama.

---

## Diegimo veiksmai

1. **Priklausomybės:** naujų npm priklausomybių **nepridėta** (Gemini kviečiama
   per `fetch`). `npm install` kaip anksčiau. `package.json`/`package-lock.json`
   nekeisti.
2. **Migracijos** (paleisti po įdiegimo):
   ```
   npm run db:migrate
   ```
   Pritaiko `003_optional_density.sql` ir `004_fuel_prices.sql`. Testų DB:
   `npm run db:migrate:test`.
3. **Aplinkos kintamieji** (Render → Environment; visa — `.env.example`):
   - Sauga: `AUTH_ENABLED=true`, `AUTH_USERNAME`, `AUTH_PASSWORD` (prod privaloma),
     `TRUST_PROXY=true`, `NODE_ENV=production`, `ROUTE_TOKEN_SECRET` (≥32 simb.).
   - Limitai (nebūtina): `EXTERNAL_DAILY_MAX`, `EXTERNAL_MAX_CONCURRENT`,
     `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AI_MAX`.
   - DI (nebūtina, numatyta išjungta): `AI_ENABLED`, `GEMINI_API_KEY`,
     `GEMINI_MODEL` — tik patikrinus nemokamą kvotą (`docs/ai-gemini-setup.md`).
   - Kuras (nebūtina): `FUEL_PRICE_ADMIN_TOKEN` importui.
   Tikrų raktų faile/Git nelaikyti; nustatyti tik serverio paslaptyse. Po
   pakeitimo — **Save and deploy / rebuild**.
4. **Pašalintų failų nėra** (nė vienas originalus failas neištrintas).

## Kas lieka / nepatikrinta

- Gyvi OSRM/ORS/Photon ir žemėlapio plytelės, tikra Gemini užklausa ir tikras LEA
  failo gavimas šiame konteineryje nepatikrinti (tinklas blokuotas) — patikrinti
  diegiant.
- Automatinis LEA tiekimas (suplanuotas darbas) — rekomenduojama Render Cron Job,
  kviečiantis administratoriaus importą; vien užmiegantis procesas nepristatomas
  kaip patikimas.
- Laisvo teksto maršruto/skaičiavimo perspėjimų vertimas į LT.
- Bendras dienos skaitiklis — procese (kelioms instancijoms reikia bendros
  saugyklos).
