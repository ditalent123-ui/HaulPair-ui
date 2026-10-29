-- 003_optional_density.sql
-- Bulk density becomes optional and may be 0 (meaning "not provided for the volume
-- estimate", not a physically zero density). The original inline CHECK required > 0.
-- Relax it to allow NULL or >= 0. Existing rows (all NULL or > 0) remain valid.

ALTER TABLE transport_calculations
  DROP CONSTRAINT IF EXISTS transport_calculations_cargo_density_t_m3_check;

ALTER TABLE transport_calculations
  ADD CONSTRAINT transport_calculations_cargo_density_nonneg
  CHECK (cargo_density_t_m3 IS NULL OR cargo_density_t_m3 >= 0);
