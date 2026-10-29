import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIDENCE_LEVELS, loadCatalog, localize, localizedName, validateCatalog } from '../../../src/lib/logistics/index.js';
import { _messagesForTests, MESSAGE_KEYS } from '../../../src/lib/logistics/i18n.js';

const catalog = loadCatalog();
const clone = (x) => JSON.parse(JSON.stringify(x));
const raw = () => clone({ cargo: catalog.cargo, trucks: catalog.trucks, trailers: catalog.trailers });

describe('catalog data validation', () => {
  it('the shipped catalog is valid', () => {
    assert.deepEqual(validateCatalog(raw()), []);
  });

  it('contains every required cargo type', () => {
    const ids = catalog.cargo.cargoTypes.map((c) => c.id);
    for (const id of ['wheat', 'barley', 'oats', 'rye', 'corn', 'rapeseed', 'potatoes', 'carrots', 'onions', 'cabbage', 'beetroot',
      'packaged_animal_feed', 'agricultural_seeds', 'hay', 'straw', 'packaged_agricultural_products', 'agricultural_machinery_components']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
  });

  it('contains the three reference tractors and four trailer types', () => {
    assert.deepEqual(catalog.trucks.tractors.map((t) => [t.id, t.referenceConsumption.valueLPer100Km]), [
      ['volvo_fh_aero_420_isave', 21.2],
      ['scania_420_r_super', 21.5],
      ['daf_xf_430', 21.59],
    ]);
    assert.deepEqual([...new Set(catalog.trailers.trailers.map((t) => t.category))].sort(), ['agricultural_tipper', 'curtainsider', 'flatbed', 'refrigerated']);
    assert.equal(catalog.trucks.defaults.estimatedConsumptionLPer100Km, 30);
    assert.equal(catalog.trucks.defaults.estimatedConsumptionConfidence, 'demo_assumption');
  });

  it('detects structural errors: duplicate ids, bad units, missing translations', () => {
    const d = raw();
    d.cargo.cargoTypes.push(clone(d.cargo.cargoTypes[0]));
    d.cargo.cargoTypes[1].names.lt = '';
    d.cargo.cargoTypes[2].bulkDensity.minTPerM3 = 720; // kg/m³ by mistake
    d.trucks.tractors[0].referenceConsumption.valueLPer100Km = 2120;
    d.trailers.trailers[0].maxPayloadKg = 40000 + 1; // combination mass, not payload
    d.trailers.trailers[1].category = 'spaceship';
    const problems = validateCatalog(d).join('\n');
    assert.match(problems, /duplicate id "wheat"/);
    assert.match(problems, /missing Lithuanian name/);
    assert.match(problems, /kg\/m³/);
    assert.match(problems, /l\/100 km/);
    assert.match(problems, /combination mass/);
    assert.match(problems, /invalid category "spaceship"/);
  });

  it('represents unknown specifications as null with a confidence tag (no guesses)', () => {
    const ski = catalog.trailerById.get('schmitz_ski_light_agri');
    assert.equal(ski.maxPayloadKg, null);
    assert.equal(ski.internalVolumeM3, null);
    assert.deepEqual(ski.volumeRangeM3, { min: 38, max: 59 });
    assert.equal(catalog.trailerById.get('schmitz_scs_universal_13_62').palletCapacity.euroPallets, 34);
    assert.equal(catalog.tractorById.get('scania_420_r_super').engine.description, null);
    assert.equal(catalog.cargoById.get('rapeseed').bulkDensity.minTPerM3, null);
    for (const list of [catalog.cargo.cargoTypes, catalog.trucks.tractors, catalog.trailers.trailers]) {
      for (const item of list) assert.ok(CONFIDENCE_LEVELS.includes(item.dataConfidence), item.id);
    }
  });

  it('only non-hazardous cargo is included in the MVP', () => {
    assert.ok(catalog.cargo.cargoTypes.every((c) => c.hazardous === false));
  });

  it('planner database seed uses catalog ids', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const seed = fs.readFileSync(path.resolve(here, '../../../../database/migrations/002_seed_reference_data.sql'), 'utf8');
    const tractorIds = [...seed.matchAll(/'((?:volvo|scania|daf)_[a-z0-9_]+)', '(schmitz_[a-z0-9_]+)'/g)];
    assert.ok(tractorIds.length >= 3);
    for (const [, tractor, trailer] of tractorIds) {
      assert.ok(catalog.tractorById.has(tractor), `seed references unknown tractor ${tractor}`);
      assert.ok(catalog.trailerById.has(trailer), `seed references unknown trailer ${trailer}`);
    }
    for (const [, code] of seed.matchAll(/^\s+\('([a-z]+)',\s+'[A-Z]/gm)) {
      assert.ok(catalog.cargoById.has(code), `seed cargo "${code}" is not in the catalog`);
    }
  });
});

describe('localisation', () => {
  it('every cargo, category, packaging and trailer category has lt and en labels', () => {
    for (const c of catalog.cargo.cargoTypes) {
      assert.ok(c.names.lt && c.names.en, c.id);
    }
    for (const group of [catalog.cargo.categories, catalog.cargo.packagingTypes, catalog.trailers.trailerCategories]) {
      for (const [id, names] of Object.entries(group)) assert.ok(names.lt && names.en, id);
    }
  });

  it('ids are language-independent and unchanged across languages', () => {
    const wheat = catalog.cargoById.get('wheat');
    assert.equal(localizedName(wheat.names, 'lt'), 'Kviečiai');
    assert.equal(localizedName(wheat.names, 'en'), 'Wheat');
    assert.equal(wheat.id, 'wheat');
    assert.ok(catalog.cargo.cargoTypes.every((c) => /^[a-z_]+$/.test(c.id)));
  });

  it('missing translations fall back lt → en → id', () => {
    assert.equal(localizedName({ lt: 'Kviečiai', en: 'Wheat' }, 'de'), 'Kviečiai');
    assert.equal(localizedName({ en: 'Wheat' }, 'lt'), 'Wheat');
    assert.equal(localizedName({}, 'lt', 'wheat'), 'wheat');
    assert.equal(localize('compat.compatible', {}, 'de'), localize('compat.compatible', {}, 'lt'));
    assert.equal(localize('no.such.key'), 'no.such.key');
  });

  it('every message key exists in both Lithuanian and English', () => {
    for (const key of MESSAGE_KEYS) {
      assert.ok(_messagesForTests.lt[key], `lt missing ${key}`);
      assert.ok(_messagesForTests.en[key], `en missing ${key}`);
    }
    assert.equal(Object.keys(_messagesForTests.lt).length, Object.keys(_messagesForTests.en).length);
  });
});
