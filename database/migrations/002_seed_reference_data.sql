-- 002_seed_reference_data.sql
-- Planner presets and grain types. Ids match the logistics catalog in
-- data/logistics/*.json (a unit test keeps them in sync).
--
-- PAYLOAD AND CONSUMPTION ARE DEMONSTRATION ASSUMPTIONS:
--   * 24 t payload  = demo payload profile (no verified vehicle configuration available)
--   * 30 l/100 km   = demo consumption estimate for loaded agricultural haulage
--     (the 21.2–21.6 l/100 km Green Truck figures are 32 t test-cycle results, not used here)
--   * height/width/length/gross/axle = general EU maxima (Directive 96/53/EC), used as
--     conservative routing restrictions, not measured vehicle dimensions.
-- Empty-run consumption is left NULL on purpose: no verified load-adjustment data exists,
-- so the calculator uses the loaded value and says so.

INSERT INTO truck_configurations
  (code, name, names, tractor_model_id, trailer_model_id, truck_type, max_payload_t, cargo_volume_m3,
   fuel_type, fuel_consumption_l_100km, empty_fuel_consumption_l_100km,
   height_m, width_m, length_m, gross_weight_t, axle_load_t, sort_order)
VALUES
  ('demo_tractor_tipper',
   'Demo profile: tractor + grain tipper semitrailer',
   '{"lt": "Demonstracinis profilis: vilkikas + grūdų savivartė puspriekabė", "en": "Demo profile: tractor + grain tipper semitrailer"}',
   NULL, NULL, 'tractor_semitrailer', 24.00, NULL,
   'diesel', 30.00, NULL, 4.00, 2.55, 16.50, 40.00, 11.50, 10),
  ('volvo_fh_aero_ski_light_59',
   'Volvo FH Aero 420 I-Save + Schmitz S.KI LIGHT (59 m³ configuration)',
   '{"lt": "Volvo FH Aero 420 I-Save + Schmitz S.KI LIGHT (59 m³ konfigūracija)", "en": "Volvo FH Aero 420 I-Save + Schmitz S.KI LIGHT (59 m³ configuration)"}',
   'volvo_fh_aero_420_isave', 'schmitz_ski_light_agri', 'tractor_semitrailer', 24.00, 59.0,
   'diesel', 30.00, NULL, 4.00, 2.55, 16.50, 40.00, 11.50, 20),
  ('daf_xf430_ski_light_38',
   'DAF XF 430 + Schmitz S.KI LIGHT (38 m³ configuration)',
   '{"lt": "DAF XF 430 + Schmitz S.KI LIGHT (38 m³ konfigūracija)", "en": "DAF XF 430 + Schmitz S.KI LIGHT (38 m³ configuration)"}',
   'daf_xf_430', 'schmitz_ski_light_agri', 'tractor_semitrailer', 24.00, 38.0,
   'diesel', 30.00, NULL, 4.00, 2.55, 16.50, 40.00, 11.50, 30),
  ('scania_420r_scs_universal',
   'Scania 420 R Super + Schmitz S.CS UNIVERSAL curtainsider (bagged grain)',
   '{"lt": "Scania 420 R Super + Schmitz S.CS UNIVERSAL tentinė (grūdai maišuose)", "en": "Scania 420 R Super + Schmitz S.CS UNIVERSAL curtainsider (bagged grain)"}',
   'scania_420_r_super', 'schmitz_scs_universal_13_62', 'tractor_semitrailer', 24.00, NULL,
   'diesel', 30.00, NULL, 4.00, 2.55, 16.50, 40.00, 11.50, 40);

-- typical_density_t_m3 = LOWER bound of the cited FAO range (conservative for the
-- volume check: lower density → more volume needed). NULL where no authoritative value was found.
INSERT INTO cargo_types (code, name, names, typical_density_t_m3, notes, sort_order) VALUES
  ('wheat',    'Wheat',        '{"lt": "Kviečiai",  "en": "Wheat"}',        0.720, 'FAO range 0.72–0.83 t/m³ (lower bound used).', 10),
  ('barley',   'Barley',       '{"lt": "Miežiai",   "en": "Barley"}',       0.610, 'FAO range 0.61–0.69 t/m³ (lower bound used).', 20),
  ('oats',     'Oats',         '{"lt": "Avižos",    "en": "Oats"}',         0.410, 'FAO 0.41–0.43 t/m³. Low density: loads are often volume-limited.', 30),
  ('rye',      'Rye',          '{"lt": "Rugiai",    "en": "Rye"}',          0.720, 'FAO 0.72 t/m³.', 40),
  ('corn',     'Corn (maize)', '{"lt": "Kukurūzai", "en": "Corn (maize)"}', 0.720, 'FAO 0.72 t/m³, shelled dried grain.', 50),
  ('rapeseed', 'Rapeseed',     '{"lt": "Rapsai",    "en": "Rapeseed"}',     NULL,  'No authoritative bulk density found; enter a measured value for the volume check.', 60);
