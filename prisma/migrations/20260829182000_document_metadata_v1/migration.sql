ALTER TABLE object_attachments
  ADD COLUMN version_number INTEGER,
  ADD COLUMN uploaded_by_user_id UUID,
  ADD COLUMN previous_attachment_id UUID;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY object_id
      ORDER BY created_at ASC, id ASC
    )::integer AS version_number
  FROM object_attachments
)
UPDATE object_attachments attachment
SET version_number = ranked.version_number
FROM ranked
WHERE attachment.id = ranked.id;

ALTER TABLE object_attachments
  ALTER COLUMN version_number SET DEFAULT 1,
  ALTER COLUMN version_number SET NOT NULL;

ALTER TABLE object_attachments
  ADD CONSTRAINT object_attachments_version_positive
    CHECK (version_number > 0),
  ADD CONSTRAINT object_attachments_file_size_nonnegative
    CHECK (file_size >= 0),
  ADD CONSTRAINT object_attachments_sha256_format
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT object_attachments_uploaded_by_user_fk
    FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT object_attachments_previous_attachment_fk
    FOREIGN KEY (previous_attachment_id) REFERENCES object_attachments(id) ON DELETE SET NULL,
  ADD CONSTRAINT object_attachments_object_version_unique
    UNIQUE (object_id, version_number);

CREATE INDEX object_attachments_tenant_object_version_idx
  ON object_attachments (tenant_id, object_id, version_number DESC);

CREATE INDEX object_attachments_uploaded_by_user_idx
  ON object_attachments (tenant_id, uploaded_by_user_id, created_at DESC);
