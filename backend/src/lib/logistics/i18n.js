/**
 * Localisation for logistics output. Lithuanian is the default language.
 * Fallback chain: requested locale → 'lt' → 'en' → message key / entity id.
 *
 * Calculation code never hardcodes display text: it returns message keys with
 * params, and callers render them with localize()/localizeReason().
 */

export const DEFAULT_LOCALE = 'lt';
export const SUPPORTED_LOCALES = Object.freeze(['lt', 'en']);
const FALLBACK_CHAIN = ['lt', 'en'];

const MESSAGES = {
  lt: {
    'compat.compatible': 'Siuntas galima vežti kartu: tinka priekaba, pakuotė, talpa ir vežimo sąlygos.',
    'compat.incompatible': 'Siuntų negalima vežti kartu.',
    'compat.needs_review': 'Siuntas galbūt galima vežti kartu, bet būtina rankinė patikra.',
    'compat.disclaimer': 'Automatinis įvertinimas. Tai nėra teisiškai privalomas krovinių vežimo saugos sertifikatas.',
    'reason.unknown_cargo_type': 'Siunta {shipmentId}: nežinoma krovinio rūšis „{cargoTypeId}“.',
    'reason.packaging_not_permitted': 'Siunta {shipmentId}: krovinys „{cargo}“ kataloge neleidžiamas pakuotei „{packaging}“.',
    'reason.trailer_category_unsuitable': 'Siunta {shipmentId}: „{cargo}“ ({packaging}) netinka vežti priekaboje „{trailer}“.',
    'reason.trailer_packaging_unsupported': 'Siunta {shipmentId}: priekaba „{trailer}“ nepritaikyta pakuotei „{packaging}“.',
    'reason.trailer_cargo_category_not_permitted': 'Siunta {shipmentId}: priekaboje „{trailer}“ neleidžiama krovinių kategorija „{category}“.',
    'reason.weight_exceeded': 'Bendra masė {totalKg} kg viršija leistiną krovinio masę {limitKg} kg.',
    'reason.weight_unknown': 'Nežinoma siuntos {shipmentId} masė.',
    'reason.payload_limit_unknown': 'Priekabos leistina krovinio masė nepatvirtinta. Nurodykite konkrečios transporto priemonės duomenis.',
    'reason.payload_demo_profile': 'Naudojamas demonstracinis {limitKg} kg krovinio masės profilis, o ne patvirtinta transporto priemonės specifikacija.',
    'reason.volume_exceeded': 'Reikalingas tūris {totalM3} m³ viršija priekabos tūrį {limitM3} m³.',
    'reason.volume_unknown': 'Nežinomas siuntos {shipmentId} tūris.',
    'reason.trailer_volume_unknown': 'Priekabos vidinis tūris nepatvirtintas (priklauso nuo konfigūracijos).',
    'reason.pallets_exceeded': 'Reikia {totalPallets} padėklų vietų, o priekaboje yra {limitPallets}.',
    'reason.pallets_unknown': 'Siuntai {shipmentId} nenurodytas padėklų vietų skaičius.',
    'reason.trailer_pallets_unknown': 'Priekabos padėklų talpa nepatvirtinta.',
    'reason.temperature_conflict': 'Temperatūros reikalavimai nesuderinami (bendro intervalo nėra).',
    'reason.temperature_control_unavailable': 'Reikalinga temperatūros kontrolė, bet priekaba „{trailer}“ jos neturi.',
    'reason.temperature_unknown': 'Siuntos {shipmentId} temperatūros reikalavimai nežinomi.',
    'reason.temperature_range_unverified': 'Priekabos temperatūros intervalas nepatvirtintas; reikalavimą {minC}…{maxC} °C reikia patikrinti.',
    'reason.bulk_mixing': 'Skirtingų birių krovinių ({cargoList}) negalima maišyti nepadalintame kėbule.',
    'reason.bulk_same_type_multiple_owners': 'Tos pačios rūšies birus krovinys iš kelių savininkų: reikia patikrinti kokybės klases ir apskaitą.',
    'reason.bulk_with_other_packaging': 'Birus krovinys negali būti vežamas kartu su kitaip supakuotais kroviniais toje pačioje savivartėje.',
    'reason.hygiene_unverified': 'Higienos suderinamumas tarp „{cargoA}“ ir „{cargoB}“ nepatikrintas.',
    'reason.contamination_risk': 'Galima užteršimo rizika: „{cargoA}“ ({riskA}) su „{cargoB}“.',
    'reason.special_handling': 'Siuntai {shipmentId} taikomos specialios sąlygos: {conditions}.',
    'reason.missing_field': 'Siuntai {shipmentId} trūksta duomenų: {field}.',
    'reason.data_unverified': 'Krovinio „{cargo}“ katalogo duomenys nepatvirtinti ({confidence}).',
    'reason.capacity_ok': 'Masė {totalKg} kg neviršija ribos {limitKg} kg.',
    'reason.space_mixed_measures': 'Dalis siuntų matuojama padėklų vietomis, dalis — tūriu; bendrą vietos poreikį reikia patikrinti rankiniu būdu.',
    'savings.no_savings': 'Bendro vežimo sutaupymo nėra, todėl platformos mokestis netaikomas.',
    'savings.participant_worse_off': 'Dalyvis {participantId} mokėtų {overEur} € daugiau nei vežant atskirai.',
    'savings.not_mutually_beneficial': 'Pasiūlymas nėra naudingas visiems dalyviams — reikia keisti išlaidų paskirstymą arba atsisakyti.',
    'savings.services_not_equivalent': 'Lyginamos paslaugos nepažymėtos kaip lygiavertės; sutaupymas negali būti patvirtintas.',
    'savings.estimated': 'Sutaupymas apskaičiuotas pagal įverčius, o ne pagal faktines sąskaitas.',
    'costs.unknown_component': 'Nežinoma išlaidų dalis: {component}.',
  },
  en: {
    'compat.compatible': 'The shipments can be transported together: trailer, packaging, capacity and conditions match.',
    'compat.incompatible': 'The shipments cannot be transported together.',
    'compat.needs_review': 'The shipments may be transportable together, but a manual review is required.',
    'compat.disclaimer': 'Automated assessment. Not a legally binding transport safety certification.',
    'reason.unknown_cargo_type': 'Shipment {shipmentId}: unknown cargo type "{cargoTypeId}".',
    'reason.packaging_not_permitted': 'Shipment {shipmentId}: "{cargo}" is not catalogued for packaging "{packaging}".',
    'reason.trailer_category_unsuitable': 'Shipment {shipmentId}: "{cargo}" ({packaging}) is not suitable for a "{trailer}" trailer.',
    'reason.trailer_packaging_unsupported': 'Shipment {shipmentId}: trailer "{trailer}" does not support packaging "{packaging}".',
    'reason.trailer_cargo_category_not_permitted': 'Shipment {shipmentId}: trailer "{trailer}" does not permit cargo category "{category}".',
    'reason.weight_exceeded': 'Total weight {totalKg} kg exceeds the permitted payload of {limitKg} kg.',
    'reason.weight_unknown': 'Weight of shipment {shipmentId} is unknown.',
    'reason.payload_limit_unknown': 'Trailer payload limit is not verified. Provide the specific vehicle configuration.',
    'reason.payload_demo_profile': 'Using the {limitKg} kg demonstration payload profile, not a verified vehicle specification.',
    'reason.volume_exceeded': 'Required volume {totalM3} m³ exceeds the trailer volume of {limitM3} m³.',
    'reason.volume_unknown': 'Volume of shipment {shipmentId} is unknown.',
    'reason.trailer_volume_unknown': 'Trailer internal volume is not verified (depends on configuration).',
    'reason.pallets_exceeded': '{totalPallets} pallet positions are needed but the trailer has {limitPallets}.',
    'reason.pallets_unknown': 'Pallet positions for shipment {shipmentId} are not specified.',
    'reason.trailer_pallets_unknown': 'Trailer pallet capacity is not verified.',
    'reason.temperature_conflict': 'Temperature requirements conflict (no common range).',
    'reason.temperature_control_unavailable': 'Temperature control is required but trailer "{trailer}" has none.',
    'reason.temperature_unknown': 'Temperature requirements of shipment {shipmentId} are unknown.',
    'reason.temperature_range_unverified': 'Trailer temperature range is not verified; the {minC}…{maxC} °C requirement must be checked.',
    'reason.bulk_mixing': 'Different bulk cargoes ({cargoList}) must not be mixed in an undivided body.',
    'reason.bulk_same_type_multiple_owners': 'Same bulk cargo from several owners: grades and quantity accounting must be checked.',
    'reason.bulk_with_other_packaging': 'Bulk cargo cannot share a tipper body with differently packaged cargo.',
    'reason.hygiene_unverified': 'Hygiene compatibility between "{cargoA}" and "{cargoB}" has not been verified.',
    'reason.contamination_risk': 'Possible contamination risk: "{cargoA}" ({riskA}) with "{cargoB}".',
    'reason.special_handling': 'Shipment {shipmentId} has special conditions: {conditions}.',
    'reason.missing_field': 'Shipment {shipmentId} is missing: {field}.',
    'reason.data_unverified': 'Catalog data for "{cargo}" is not verified ({confidence}).',
    'reason.capacity_ok': 'Weight {totalKg} kg is within the {limitKg} kg limit.',
    'reason.space_mixed_measures': 'Some shipments are measured in pallet positions and others in volume; combined space must be checked manually.',
    'savings.no_savings': 'Combined transport produces no savings, so no platform fee applies.',
    'savings.participant_worse_off': 'Participant {participantId} would pay {overEur} € more than their independent alternative.',
    'savings.not_mutually_beneficial': 'The arrangement is not beneficial for every participant — change the cost allocation or reject it.',
    'savings.services_not_equivalent': 'The compared services are not marked as equivalent; savings cannot be confirmed.',
    'savings.estimated': 'Savings are based on estimates, not actual invoices.',
    'costs.unknown_component': 'Unknown cost component: {component}.',
  },
};

function chainFor(locale) {
  return [locale, ...FALLBACK_CHAIN].filter((l, i, arr) => l && arr.indexOf(l) === i);
}

/** Translate a message key. Missing params are left as {name}. */
export function localize(key, params = {}, locale = DEFAULT_LOCALE) {
  let template = key;
  for (const l of chainFor(locale)) {
    if (MESSAGES[l]?.[key]) {
      template = MESSAGES[l][key];
      break;
    }
  }
  return template.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

/** Pick a localized name from a { lt, en, ... } object with the standard fallback. */
export function localizedName(names, locale = DEFAULT_LOCALE, fallbackId = '') {
  if (!names) return fallbackId;
  for (const l of chainFor(locale)) if (typeof names[l] === 'string' && names[l]) return names[l];
  return fallbackId;
}

export function hasMessage(key, locale) {
  return Boolean(MESSAGES[locale]?.[key]);
}

export const MESSAGE_KEYS = Object.freeze(Object.keys(MESSAGES.en));
export const _messagesForTests = MESSAGES;
