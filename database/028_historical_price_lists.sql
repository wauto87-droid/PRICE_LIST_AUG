CREATE TABLE historical_price_lists (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE historical_price_entries (
  list_id uuid NOT NULL REFERENCES historical_price_lists(id) ON DELETE CASCADE,
  part_number text NOT NULL,
  valid_from date,
  valid_to date,
  price numeric(12, 2) NOT NULL
);

CREATE INDEX historical_price_entries_part_number_idx ON historical_price_entries(part_number);
CREATE INDEX historical_price_entries_list_id_idx ON historical_price_entries(list_id);
