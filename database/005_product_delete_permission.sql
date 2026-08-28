UPDATE roles
SET permissions = CASE
  WHEN NOT ('PRODUCT_DELETE' = ANY(permissions))
    THEN array_append(permissions, 'PRODUCT_DELETE')
  ELSE permissions
END
WHERE id = 'ADMIN';
