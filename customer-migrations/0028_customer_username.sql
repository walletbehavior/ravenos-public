PRAGMA foreign_keys = ON;

-- Sign-in provider names are deliberately not RavenOS display identities.
-- A username is user-selected, normalized lowercase ASCII and globally unique.
ALTER TABLE ravenos_users ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ravenos_users_username_unique_idx
  ON ravenos_users(lower(username))
  WHERE username IS NOT NULL;
