CREATE TABLE price_lookup_history (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES price_watch_events(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  snapshot jsonb NOT NULL,
  request jsonb,
  legacy boolean NOT NULL DEFAULT false
);
CREATE INDEX price_lookup_history_actor_date ON price_lookup_history(actor_id,captured_at DESC,id);
CREATE INDEX price_lookup_history_event ON price_lookup_history(event_id);
INSERT INTO price_lookup_history(id,event_id,actor_id,captured_at,snapshot,legacy)
SELECT id,id,actor_id,last_seen_at,to_jsonb(e),true FROM price_watch_events e WHERE stage='LOOKUP';
CREATE VIEW price_watch_activity AS
SELECT s.*,h.event_id AS interaction_id,
       CASE WHEN h.legacy THEN 'Legacy snapshot' ELSE 'Calculation' END AS evidence
FROM price_lookup_history h
JOIN price_watch_events current_event ON current_event.id=h.event_id
CROSS JOIN LATERAL jsonb_populate_record(NULL::price_watch_events,
  h.snapshot || jsonb_build_object('id',h.id,'stage','LOOKUP','actor_id',h.actor_id,
    'first_seen_at',h.captured_at,'last_seen_at',h.captured_at,
    'quotation_id',current_event.quotation_id,'customer_name',current_event.customer_name)) s
UNION ALL
SELECT e.*,e.id AS interaction_id,'Lifecycle'::text AS evidence
FROM price_watch_events e
WHERE e.stage<>'LOOKUP' OR NOT EXISTS (SELECT 1 FROM price_lookup_history h WHERE h.event_id=e.id);
