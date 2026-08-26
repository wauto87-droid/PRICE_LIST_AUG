ALTER TABLE product_pricing ADD COLUMN default_level text NOT NULL DEFAULT 'END_CUSTOMER';
CREATE TABLE product_selling_levels (
  product_id uuid NOT NULL REFERENCES products(id),
  code text NOT NULL CHECK(code IN ('WHOLESALE','RETAIL','END_CUSTOMER')),
  active boolean NOT NULL DEFAULT true,
  method text NOT NULL CHECK(method IN ('FIXED','COST_MARKUP','LIST_DISCOUNT')),
  fixed_price numeric(20,6) NOT NULL DEFAULT 0 CHECK(fixed_price>=0),
  markup numeric(20,6) NOT NULL DEFAULT 0 CHECK(markup>=0),
  list_price numeric(20,6) NOT NULL DEFAULT 0 CHECK(list_price>=0),
  base_discount numeric(9,6) NOT NULL DEFAULT 0 CHECK(base_discount BETWEEN 0 AND 100),
  PRIMARY KEY(product_id,code)
);
INSERT INTO product_selling_levels(product_id,code,method,markup,list_price,base_discount)
SELECT product_id,'END_CUSTOMER',method,markup,list_price,base_discount FROM product_pricing;
ALTER TABLE product_pricing ADD CONSTRAINT default_level_valid CHECK(default_level IN ('WHOLESALE','RETAIL','END_CUSTOMER'));
ALTER TABLE product_pricing ADD CONSTRAINT default_level_reference FOREIGN KEY(product_id,default_level) REFERENCES product_selling_levels(product_id,code) DEFERRABLE INITIALLY DEFERRED;
