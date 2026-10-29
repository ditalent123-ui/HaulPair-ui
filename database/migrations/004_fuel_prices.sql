-- 004_fuel_prices.sql
-- Shared, server-side store of a verified fuel-price suggestion per fuel type,
-- plus a per-calculation snapshot of the price origin and date.
--
-- The suggestion is read by all visitors from this single shared record, so a
-- fuel-type selection never triggers a per-visitor external call. The owner's
-- source is LEA (Lietuvos energetikos agentūra); the automatic ingestion path is
-- not yet verified, so rows arrive via admin import until it is.

CREATE TABLE fuel_prices (
  fuel_type        TEXT PRIMARY KEY CHECK (fuel_type ~ '^[a-z][a-z0-9_]*$'),
  price_eur_per_l  NUMERIC(6,3) NOT NULL CHECK (price_eur_per_l > 0),
  price_date       DATE NOT NULL,                 -- the source's published price date (NOT the fetch time)
  geography        TEXT NOT NULL DEFAULT 'LT',
  price_basis      TEXT NOT NULL,                 -- e.g. 'Lithuania retail average, VAT incl.'
  source_name      TEXT NOT NULL,
  source_url       TEXT NOT NULL,
  method           TEXT NOT NULL DEFAULT 'manual_import'
                   CHECK (method IN ('manual_import', 'lea_adapter', 'ai_assisted')),
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Snapshot of the price actually used in each saved calculation, so reopening an
-- old calculation shows the price, origin and date it was made with — not today's.
ALTER TABLE transport_calculations
  ADD COLUMN fuel_price_origin TEXT CHECK (fuel_price_origin IN ('manual', 'lea', 'suggested')),
  ADD COLUMN fuel_price_date   DATE,
  ADD COLUMN fuel_price_source TEXT;
