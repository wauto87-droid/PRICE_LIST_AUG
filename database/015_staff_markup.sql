ALTER TABLE price_watch_events
  ADD COLUMN IF NOT EXISTS requested_markup numeric(9,6) NOT NULL DEFAULT 0 CHECK(requested_markup BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS effective_markup numeric(9,6) NOT NULL DEFAULT 0 CHECK(effective_markup BETWEEN 0 AND 100);
