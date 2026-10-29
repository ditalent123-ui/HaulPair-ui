-- 005_fuel_price_history.sql
-- History of accepted diesel (and other fuel) prices, for the price tracker's
-- trend chart. Every validated value written to fuel_prices (admin LEA import or
-- validated AI result) is also appended here with its source and timestamp.

CREATE TABLE fuel_price_history (
  id               BIGSERIAL PRIMARY KEY,
  fuel_type        TEXT NOT NULL CHECK (fuel_type ~ '^[a-z][a-z0-9_]*$'),
  price_eur_per_l  NUMERIC(6,3) NOT NULL CHECK (price_eur_per_l > 0),
  price_date       DATE NOT NULL,
  source_name      TEXT NOT NULL,
  source_url       TEXT NOT NULL,
  method           TEXT NOT NULL CHECK (method IN ('manual_import', 'lea_adapter', 'ai_assisted')),
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX fuel_price_history_type_date_idx ON fuel_price_history (fuel_type, price_date DESC, recorded_at DESC);
