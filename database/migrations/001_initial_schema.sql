-- 001_initial_schema.sql
-- Core schema for the grain transport route-planning prototype.
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in from 13).

CREATE TABLE truck_configurations (
  id                               SERIAL PRIMARY KEY,
  code                             TEXT NOT NULL UNIQUE,
  name                             TEXT NOT NULL,
  -- Localised display names, e.g. {"lt": "...", "en": "..."}; `name` is the English fallback.
  names                            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Optional links to the logistics catalog (data/logistics/*.json)
  tractor_model_id                 TEXT,
  trailer_model_id                 TEXT,
  truck_type                       TEXT NOT NULL
                                   CHECK (truck_type IN ('rigid', 'rigid_drawbar', 'tractor_semitrailer')),
  max_payload_t                    NUMERIC(6,2) NOT NULL CHECK (max_payload_t > 0),
  cargo_volume_m3                  NUMERIC(6,1) CHECK (cargo_volume_m3 > 0),
  fuel_type                        TEXT NOT NULL
                                   CHECK (fuel_type IN ('diesel', 'hvo', 'biodiesel', 'lng', 'cng')),
  fuel_consumption_l_100km         NUMERIC(5,2) NOT NULL CHECK (fuel_consumption_l_100km > 0),
  empty_fuel_consumption_l_100km   NUMERIC(5,2) CHECK (empty_fuel_consumption_l_100km > 0),
  height_m                         NUMERIC(4,2) CHECK (height_m > 0),
  width_m                          NUMERIC(4,2) CHECK (width_m > 0),
  length_m                         NUMERIC(5,2) CHECK (length_m > 0),
  gross_weight_t                   NUMERIC(5,2) CHECK (gross_weight_t > 0),
  axle_load_t                      NUMERIC(4,2) CHECK (axle_load_t > 0),
  is_demo_assumption               BOOLEAN NOT NULL DEFAULT TRUE,
  is_active                        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order                       INTEGER NOT NULL DEFAULT 0,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cargo_types (
  id                        SERIAL PRIMARY KEY,
  code                      TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  name                      TEXT NOT NULL,
  names                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Typical bulk density, used only for an optional volume check; editable by the user per calculation.
  typical_density_t_m3      NUMERIC(4,3) CHECK (typical_density_t_m3 > 0 AND typical_density_t_m3 < 2),
  notes                     TEXT,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order                INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transport_calculations (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  label                            TEXT CHECK (char_length(label) <= 120),
  calculation_version              TEXT NOT NULL,
  currency                         CHAR(3) NOT NULL DEFAULT 'EUR',

  -- Route (figures come from the routing provider via a signed route token)
  origin_label                     TEXT NOT NULL,
  origin_lat                       DOUBLE PRECISION NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lon                       DOUBLE PRECISION NOT NULL CHECK (origin_lon BETWEEN -180 AND 180),
  destination_label                TEXT NOT NULL,
  destination_lat                  DOUBLE PRECISION NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
  destination_lon                  DOUBLE PRECISION NOT NULL CHECK (destination_lon BETWEEN -180 AND 180),
  routing_provider                 TEXT NOT NULL,
  routing_profile                  TEXT NOT NULL,
  truck_restrictions_applied       BOOLEAN NOT NULL,
  outbound_distance_km             NUMERIC(10,3) NOT NULL CHECK (outbound_distance_km > 0),
  outbound_duration_s              INTEGER CHECK (outbound_duration_s >= 0),
  return_mode                      TEXT NOT NULL CHECK (return_mode IN ('none', 'empty', 'loaded')),
  return_distance_km               NUMERIC(10,3) CHECK (return_distance_km > 0),
  return_duration_s                INTEGER CHECK (return_duration_s >= 0),
  route_metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Truck (snapshot of the values actually used; the FK only records which preset it started from)
  truck_configuration_id           INTEGER REFERENCES truck_configurations(id) ON DELETE SET NULL,
  truck_snapshot                   JSONB NOT NULL,
  truck_capacity_t                 NUMERIC(6,2) NOT NULL CHECK (truck_capacity_t > 0),
  fuel_type                        TEXT NOT NULL,
  fuel_consumption_l_100km         NUMERIC(5,2) NOT NULL CHECK (fuel_consumption_l_100km > 0),
  empty_fuel_consumption_l_100km   NUMERIC(5,2) CHECK (empty_fuel_consumption_l_100km > 0),
  fuel_price_eur_l                 NUMERIC(6,3) NOT NULL CHECK (fuel_price_eur_l > 0),

  -- Cargo
  cargo_type_id                    INTEGER NOT NULL REFERENCES cargo_types(id) ON DELETE RESTRICT,
  cargo_type_code                  TEXT NOT NULL,
  cargo_quantity_t                 NUMERIC(6,3) NOT NULL CHECK (cargo_quantity_t > 0),
  return_cargo_quantity_t          NUMERIC(6,3) CHECK (return_cargo_quantity_t > 0),
  cargo_density_t_m3               NUMERIC(4,3) CHECK (cargo_density_t_m3 > 0),

  -- Cost components (EUR, 4 decimals retained; rounding happens only for display)
  fuel_litres                      NUMERIC(12,4) NOT NULL CHECK (fuel_litres >= 0),
  fuel_cost_eur                    NUMERIC(12,4) NOT NULL CHECK (fuel_cost_eur >= 0),
  tolls_eur                        NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (tolls_eur >= 0),
  return_tolls_eur                 NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (return_tolls_eur >= 0),
  loading_unloading_eur            NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (loading_unloading_eur >= 0),
  driver_cost_eur                  NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (driver_cost_eur >= 0),
  other_cost_eur                   NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (other_cost_eur >= 0),
  total_cost_eur                   NUMERIC(12,4) NOT NULL CHECK (total_cost_eur >= 0),
  cost_per_tonne_eur               NUMERIC(12,4) NOT NULL CHECK (cost_per_tonne_eur >= 0),
  cost_per_tonne_km_eur            NUMERIC(12,6) NOT NULL CHECK (cost_per_tonne_km_eur >= 0),
  capacity_utilization_pct         NUMERIC(6,2) NOT NULL CHECK (capacity_utilization_pct > 0 AND capacity_utilization_pct <= 100),

  -- Full inputs and results for audit / reproduction
  inputs                           JSONB NOT NULL,
  results                          JSONB NOT NULL,

  CONSTRAINT return_fields_consistent CHECK (
    (return_mode = 'none' AND return_distance_km IS NULL AND return_cargo_quantity_t IS NULL)
    OR (return_mode = 'empty' AND return_distance_km IS NOT NULL AND return_cargo_quantity_t IS NULL)
    OR (return_mode = 'loaded' AND return_distance_km IS NOT NULL AND return_cargo_quantity_t IS NOT NULL)
  ),
  CONSTRAINT cargo_within_capacity CHECK (cargo_quantity_t <= truck_capacity_t),
  CONSTRAINT return_cargo_within_capacity CHECK (return_cargo_quantity_t IS NULL OR return_cargo_quantity_t <= truck_capacity_t)
);

CREATE INDEX transport_calculations_created_at_idx ON transport_calculations (created_at DESC, id);
CREATE INDEX transport_calculations_cargo_type_idx ON transport_calculations (cargo_type_id);
CREATE INDEX transport_calculations_truck_config_idx ON transport_calculations (truck_configuration_id);

CREATE TABLE activity_logs (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type    TEXT NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type   TEXT,
  entity_id     TEXT,
  request_id    TEXT,
  -- Business metadata only: no IP addresses, API keys or free-text personal data.
  details       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX activity_logs_created_at_idx ON activity_logs (created_at DESC);
CREATE INDEX activity_logs_event_type_idx ON activity_logs (event_type, created_at DESC);
