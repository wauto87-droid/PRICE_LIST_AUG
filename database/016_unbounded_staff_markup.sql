ALTER TABLE price_watch_events
  DROP CONSTRAINT IF EXISTS price_watch_events_requested_markup_check,
  DROP CONSTRAINT IF EXISTS price_watch_events_effective_markup_check;

ALTER TABLE price_watch_events
  ALTER COLUMN requested_markup TYPE numeric(20,6),
  ALTER COLUMN effective_markup TYPE numeric(20,6);

ALTER TABLE price_watch_events
  ADD CONSTRAINT price_watch_events_requested_markup_check
    CHECK(requested_markup >= 0),
  ADD CONSTRAINT price_watch_events_effective_markup_check
    CHECK(effective_markup >= 0);
