-- Opt-in session persistence. Existing auth states and sessions retain their
-- original expiry; this migration does not create or extend any session.
ALTER TABLE ravenos_auth_states ADD COLUMN remember_device INTEGER NOT NULL DEFAULT 0 CHECK (remember_device IN (0, 1));
ALTER TABLE ravenos_sessions ADD COLUMN remember_device INTEGER NOT NULL DEFAULT 0 CHECK (remember_device IN (0, 1));
