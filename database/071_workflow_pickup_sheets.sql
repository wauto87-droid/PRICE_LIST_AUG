CREATE TABLE IF NOT EXISTS sw_pickup_sheets(id text PRIMARY KEY,document_id text NOT NULL,order_id text NOT NULL,number text NOT NULL,revision integer NOT NULL,hash text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(number,revision));
CREATE INDEX IF NOT EXISTS sw_pickup_sheets_order ON sw_pickup_sheets(order_id,created_at);
