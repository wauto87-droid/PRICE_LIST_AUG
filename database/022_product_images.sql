CREATE TABLE product_images (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  original_path text NOT NULL,
  thumbnail_path text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  caption text NOT NULL DEFAULT '',
  display_order integer NOT NULL CHECK (display_order BETWEEN 0 AND 4),
  uploader_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, display_order)
);
CREATE INDEX product_images_product_idx ON product_images(product_id, display_order);
