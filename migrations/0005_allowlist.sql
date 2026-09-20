-- 0005 — invite-only allow-list, managed in the app by admins
--
-- email is lower-case; an entry starting with "@" allows a whole domain.
-- ADMIN_EMAILS (config) is always allowed and admin regardless of this table,
-- so it can never lock the operator out.

CREATE TABLE allowed_users (
  email      text PRIMARY KEY CHECK (email = lower(email)),
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  note       text,
  added_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO allowed_users (email, role, note) VALUES ('silla@solidstart.jp', 'admin', 'owner');
