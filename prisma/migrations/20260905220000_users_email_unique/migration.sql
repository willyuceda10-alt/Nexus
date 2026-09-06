-- USERS EMAIL UNIQUENESS
--
-- users.email previously carried only a non-unique index, so the invite flow's
-- find-then-create could race two admins into two User rows for one address. The
-- identity link then attached to an arbitrary one of them and the invitation on
-- the other row was orphaned with no way to ever accept it.
--
-- Uniqueness is enforced case-insensitively because every lookup in the codebase
-- compares emails case-insensitively (Entra returns the UPN in mixed case).

-- Collapse any duplicates that already exist before the constraint can be added.
-- The surviving row is the oldest one; memberships and identities from the
-- duplicates are repointed onto it, and per-user rows that would collide on the
-- survivor are dropped rather than merged (an invited duplicate carries no data).
DO $$
DECLARE
  duplicate record;
  survivor_id uuid;
BEGIN
  FOR duplicate IN
    SELECT lower(email) AS normalized_email
    FROM users
    GROUP BY lower(email)
    HAVING count(*) > 1
  LOOP
    SELECT id INTO survivor_id
    FROM users
    WHERE lower(email) = duplicate.normalized_email
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Drop memberships on losing rows that would collide with the survivor's.
    DELETE FROM tenant_memberships losing
    USING users u
    WHERE losing.user_id = u.id
      AND lower(u.email) = duplicate.normalized_email
      AND losing.user_id <> survivor_id
      AND EXISTS (
        SELECT 1 FROM tenant_memberships kept
        WHERE kept.user_id = survivor_id
          AND kept.tenant_id = losing.tenant_id
      );

    UPDATE tenant_memberships m
    SET user_id = survivor_id
    FROM users u
    WHERE m.user_id = u.id
      AND lower(u.email) = duplicate.normalized_email
      AND m.user_id <> survivor_id;

    UPDATE user_identities i
    SET user_id = survivor_id
    FROM users u
    WHERE i.user_id = u.id
      AND lower(u.email) = duplicate.normalized_email
      AND i.user_id <> survivor_id;

    DELETE FROM users
    WHERE lower(email) = duplicate.normalized_email
      AND id <> survivor_id;
  END LOOP;
END $$;

-- Normalize stored casing so the column matches how it is always queried.
UPDATE users SET email = lower(email) WHERE email <> lower(email);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON users (lower(email));
