-- 0004 — spaces
--
-- A space is the unit of sharing. Every document belongs to exactly one space;
-- users belong to any number of spaces and have a "current" one. Files for a
-- space live in the space OWNER's Google Drive, under Paper Archive/<space>/,
-- uploaded with the owner's grant — so a space really is a folder, and members
-- never have to decide where things go.
--
-- Backfill: every existing user gets a personal space owning their documents.

CREATE TABLE spaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  owner_user_id   uuid NOT NULL REFERENCES users(id),
  drive_folder_id text,                       -- Paper Archive/<name> in the owner's Drive
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER spaces_touch BEFORE UPDATE ON spaces
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE space_members (
  space_id   uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX space_members_user_idx ON space_members (user_id);

-- Invite links. A capability token, time-limited, multi-use up to max_uses.
CREATE TABLE space_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  max_uses    integer NOT NULL DEFAULT 10,
  uses        integer NOT NULL DEFAULT 0,
  revoked_at  timestamptz
);

ALTER TABLE users      ADD COLUMN current_space_id uuid REFERENCES spaces(id) ON DELETE SET NULL;
ALTER TABLE documents  ADD COLUMN space_id uuid REFERENCES spaces(id) ON DELETE CASCADE;
ALTER TABLE scan_costs ADD COLUMN space_id uuid REFERENCES spaces(id) ON DELETE SET NULL;

-- Backfill: one personal space per existing user, named after them.
INSERT INTO spaces (name, owner_user_id)
  SELECT coalesce(nullif(name, ''), split_part(email, '@', 1)), id FROM users;
INSERT INTO space_members (space_id, user_id, role)
  SELECT id, owner_user_id, 'owner' FROM spaces;
UPDATE users u SET current_space_id = s.id
  FROM spaces s WHERE s.owner_user_id = u.id AND u.current_space_id IS NULL;
UPDATE documents d SET space_id = s.id
  FROM spaces s WHERE s.owner_user_id = d.user_id AND d.space_id IS NULL;
UPDATE scan_costs c SET space_id = s.id
  FROM spaces s WHERE s.owner_user_id = c.user_id AND c.space_id IS NULL;

ALTER TABLE documents ALTER COLUMN space_id SET NOT NULL;

-- documents.user_id now means "scanned by"; queries scope by space.
CREATE INDEX documents_space_created_idx ON documents (space_id, created_at DESC);
CREATE INDEX documents_space_action_idx  ON documents (space_id, action_date) WHERE action_required;
CREATE INDEX scan_costs_space_created_idx ON scan_costs (space_id, created_at DESC);
