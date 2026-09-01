CREATE TABLE price_watch_events (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  stage text NOT NULL CHECK(stage IN ('LOOKUP','CART','DRAFT','ISSUED')),
  source text NOT NULL CHECK(source IN ('CATALOG','CUSTOM')),
  product_id uuid REFERENCES products(id),
  reusable_item_id uuid REFERENCES reusable_custom_items(id) ON DELETE SET NULL,
  item_key text NOT NULL,
  part_number text NOT NULL DEFAULT '',
  description text NOT NULL,
  unit text NOT NULL,
  selling_level text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK(quantity>0),
  master_excl numeric(20,2) NOT NULL CHECK(master_excl>=0),
  final_excl numeric(20,2) NOT NULL CHECK(final_excl>=0),
  final_incl numeric(20,2) NOT NULL CHECK(final_incl>=0),
  requested_discount numeric(9,6) NOT NULL CHECK(requested_discount BETWEEN 0 AND 100),
  effective_discount numeric(9,6) NOT NULL CHECK(effective_discount BETWEEN 0 AND 100),
  vat_rate numeric(9,6) NOT NULL CHECK(vat_rate BETWEEN 0 AND 100),
  subtotal numeric(20,2) NOT NULL CHECK(subtotal>=0),
  total numeric(20,2) NOT NULL CHECK(total>=0),
  minimum_reached boolean NOT NULL DEFAULT false,
  discount_limited boolean NOT NULL DEFAULT false,
  quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL,
  quotation_line_index integer,
  customer_name text NOT NULL DEFAULT '',
  quote_round_off numeric(20,2) NOT NULL DEFAULT 0,
  revision_count integer NOT NULL DEFAULT 1 CHECK(revision_count>0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_watch_actor_date ON price_watch_events(actor_id,last_seen_at DESC);
CREATE INDEX price_watch_item_date ON price_watch_events(item_key,last_seen_at DESC);
CREATE INDEX price_watch_stage_date ON price_watch_events(stage,last_seen_at DESC);
CREATE INDEX price_watch_quote ON price_watch_events(quotation_id,quotation_line_index);

INSERT INTO price_watch_events(
  id,actor_id,stage,source,product_id,reusable_item_id,item_key,part_number,description,unit,
  selling_level,quantity,master_excl,final_excl,final_incl,requested_discount,effective_discount,
  vat_rate,subtotal,total,minimum_reached,discount_limited,quotation_id,quotation_line_index,
  customer_name,quote_round_off,first_seen_at,last_seen_at,created_at,updated_at
)
SELECT
  md5(q.id::text||':'||line_no::text)::uuid,
  q.owner_id,
  CASE WHEN q.status='ISSUED' THEN 'ISSUED' ELSE 'DRAFT' END,
  CASE WHEN (line->>'source')='CUSTOM' OR jsonb_extract_path_text(line,'input','type')='CUSTOM' THEN 'CUSTOM' ELSE 'CATALOG' END,
  CASE WHEN (line->>'source')='CUSTOM' OR jsonb_extract_path_text(line,'input','type')='CUSTOM' THEN NULL ELSE COALESCE(NULLIF(line->>'productId',''),NULLIF(jsonb_extract_path_text(line,'input','productId'),''))::uuid END,
  NULLIF(jsonb_extract_path_text(line,'input','reusableItemId'),'')::uuid,
  CASE
    WHEN NOT ((line->>'source')='CUSTOM' OR jsonb_extract_path_text(line,'input','type')='CUSTOM') THEN concat('CATALOG:',COALESCE(line->>'productId',jsonb_extract_path_text(line,'input','productId')))
    WHEN COALESCE(jsonb_extract_path_text(line,'input','reusableItemId'),'')<>'' THEN concat('REUSABLE:',jsonb_extract_path_text(line,'input','reusableItemId'))
    WHEN btrim(COALESCE(line->>'partNumber',''))<>'' THEN concat('CUSTOM-REF:',upper(regexp_replace(btrim(line->>'partNumber'),'\s+',' ','g')))
    ELSE concat('CUSTOM-DESC:',upper(regexp_replace(btrim(line->>'description'),'\s+',' ','g')))
  END,
  COALESCE(line->>'partNumber',''),COALESCE(line->>'description',''),COALESCE(line->>'unit','pcs'),
  COALESCE(line->>'sellingLevel',jsonb_extract_path_text(line,'price','sellingLevel'),'CUSTOM'),
  COALESCE(jsonb_extract_path_text(line,'price','quantity'),jsonb_extract_path_text(line,'input','quantity'),'1')::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','masterExcl'),jsonb_extract_path_text(line,'price','finalExcl'),'0')::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','finalExcl'),'0')::numeric,COALESCE(jsonb_extract_path_text(line,'price','finalIncl'),jsonb_extract_path_text(line,'price','finalExcl'),'0')::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','requestedDiscount'),jsonb_extract_path_text(line,'input','discount'),'0')::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','effectiveDiscount'),jsonb_extract_path_text(line,'input','discount'),'0')::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','vatRate'),'0')::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','subtotal'),(COALESCE(jsonb_extract_path_text(line,'price','finalExcl'),'0')::numeric*COALESCE(jsonb_extract_path_text(line,'input','quantity'),'1')::numeric)::text)::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','total'),(COALESCE(jsonb_extract_path_text(line,'price','finalIncl'),jsonb_extract_path_text(line,'price','finalExcl'),'0')::numeric*COALESCE(jsonb_extract_path_text(line,'input','quantity'),'1')::numeric)::text)::numeric,
  COALESCE(jsonb_extract_path_text(line,'price','minimumReached')::boolean,false),COALESCE(jsonb_extract_path_text(line,'price','discountLimited')::boolean,false),
  q.id,line_no-1,COALESCE(q.customer->>'name',''),COALESCE((q.totals->>'quoteDiscount')::numeric,0),
  COALESCE(q.issued_at,q.created_at),COALESCE(q.issued_at,q.updated_at),q.created_at,q.updated_at
FROM quotations q
CROSS JOIN LATERAL jsonb_array_elements(q.lines) WITH ORDINALITY AS lines(line,line_no)
WHERE q.status IN ('DRAFT','ISSUED') AND jsonb_typeof(line->'price')='object';

UPDATE roles SET permissions=array_append(permissions,'PRICE_WATCHER')
WHERE id='ADMIN' AND NOT ('PRICE_WATCHER'=ANY(permissions));
