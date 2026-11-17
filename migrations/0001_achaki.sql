CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 90),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, user_id)
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;
CREATE INDEX resets_expiry ON password_resets(expires_at);
CREATE INDEX resets_user ON password_resets(user_id);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  next_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX oauth_expiry ON oauth_states(expires_at);

CREATE TABLE limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX limits_expiry ON limits(expires_at);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sector_phone TEXT NOT NULL DEFAULT '',
  sector_location TEXT NOT NULL DEFAULT 'Setor de Achados e Perdidos da Fatec',
  sector_hours TEXT NOT NULL DEFAULT '',
  review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0,1))
) STRICT;

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('found','lost')),
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 90),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 8 AND 1200),
  category_id TEXT NOT NULL REFERENCES categories(id),
  location TEXT NOT NULL DEFAULT '',
  occurred_on TEXT NOT NULL,
  custody TEXT CHECK (custody IN ('finder','campus')),
  status TEXT NOT NULL DEFAULT 'open',
  publication TEXT NOT NULL CHECK (publication IN ('public','pending','hidden','private')),
  share_phone INTEGER NOT NULL DEFAULT 0 CHECK (share_phone IN (0,1)),
  search_text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  reservation_name TEXT,
  reserved_contact_id TEXT REFERENCES contacts(id),
  reserved_lost_id TEXT REFERENCES items(id),
  recovery_for_id TEXT REFERENCES items(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT,
  CHECK (
    (kind = 'found' AND custody IS NOT NULL AND status IN ('open','reserved','returned') AND recovery_for_id IS NULL) OR
    (kind = 'lost' AND custody IS NULL AND status IN ('open','recovered') AND publication = 'private')
  ),
  CHECK (kind = 'lost' OR length(location) >= 2),
  CHECK (status = 'reserved' OR (reservation_name IS NULL AND reserved_contact_id IS NULL AND reserved_lost_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX items_no_duplicates ON items(author_id,kind,fingerprint) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX found_no_duplicates ON items(fingerprint) WHERE kind = 'found' AND archived_at IS NULL;
CREATE INDEX items_public ON items(kind,publication,archived_at,occurred_on DESC);
CREATE INDEX items_author ON items(author_id,archived_at,created_at DESC);
CREATE INDEX items_matches ON items(kind,category_id,status,archived_at,occurred_on);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT REFERENCES items(id),
  position INTEGER CHECK (position BETWEEN 1 AND 3),
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  created_at INTEGER NOT NULL,
  discard INTEGER NOT NULL DEFAULT 0 CHECK (discard IN (0,1)),
  UNIQUE (item_id,position),
  CHECK ((item_id IS NULL AND position IS NULL) OR (item_id IS NOT NULL AND position IS NOT NULL))
) STRICT;
CREATE INDEX media_cleanup ON media(discard,created_at) WHERE item_id IS NULL;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  lost_id TEXT NOT NULL REFERENCES items(id),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 10 AND 700),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','delivered')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE UNIQUE INDEX contacts_active ON contacts(item_id,requester_id) WHERE status IN ('pending','approved');
CREATE UNIQUE INDEX contacts_approved ON contacts(item_id) WHERE status = 'approved';
CREATE INDEX contacts_item ON contacts(item_id,status,created_at DESC);
CREATE INDEX contacts_requester ON contacts(requester_id,created_at DESC);

CREATE TABLE returns (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES items(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT REFERENCES users(id),
  recipient_name TEXT NOT NULL CHECK (length(recipient_name) BETWEEN 2 AND 90),
  lost_id TEXT UNIQUE REFERENCES items(id),
  contact_id TEXT UNIQUE REFERENCES contacts(id),
  returned_on TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  custody TEXT NOT NULL CHECK (custody IN ('finder','campus')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (recipient_id IS NULL OR lost_id IS NOT NULL),
  CHECK (recipient_id IS NULL OR actor_id <> recipient_id)
) STRICT;

CREATE TABLE ratings (
  item_id TEXT NOT NULL REFERENCES returns(item_id),
  user_id TEXT NOT NULL REFERENCES users(id),
  perspective TEXT NOT NULL CHECK (perspective IN ('finder','recipient')),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 700),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (item_id,perspective)
) STRICT;

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT REFERENCES items(id),
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX audit_item ON audit(item_id,id DESC);

CREATE TRIGGER audit_item_create AFTER INSERT ON items BEGIN
  INSERT INTO audit(actor_id,item_id,action,details) VALUES (NEW.updated_by,NEW.id,'created',NEW.status);
END;

CREATE TRIGGER audit_item_update AFTER UPDATE ON items
WHEN OLD.status <> NEW.status OR OLD.custody IS NOT NEW.custody OR OLD.publication <> NEW.publication
  OR OLD.archived_at IS NOT NEW.archived_at OR OLD.title <> NEW.title OR OLD.description <> NEW.description
  OR OLD.location <> NEW.location OR OLD.category_id <> NEW.category_id OR OLD.occurred_on <> NEW.occurred_on
  OR OLD.share_phone <> NEW.share_phone OR OLD.reservation_name IS NOT NEW.reservation_name
  OR OLD.reserved_lost_id IS NOT NEW.reserved_lost_id OR OLD.reserved_contact_id IS NOT NEW.reserved_contact_id
BEGIN
  INSERT INTO audit(actor_id,item_id,action,details) VALUES (
    NEW.updated_by,NEW.id,
    CASE WHEN NEW.archived_at IS NOT NULL THEN 'archived' WHEN OLD.archived_at IS NOT NULL THEN 'restored'
         WHEN OLD.status <> NEW.status THEN 'status' WHEN OLD.custody IS NOT NEW.custody THEN 'custody'
         WHEN OLD.publication <> NEW.publication THEN 'publication' ELSE 'edited' END,
    CASE WHEN OLD.status <> NEW.status THEN NEW.status WHEN OLD.custody IS NOT NEW.custody THEN NEW.custody
         WHEN OLD.publication <> NEW.publication THEN NEW.publication ELSE '' END
  );
END;

CREATE TRIGGER returns_validate BEFORE INSERT ON returns BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM items i JOIN users a ON a.id = NEW.actor_id AND a.active = 1
    WHERE i.id = NEW.item_id AND i.kind = 'found' AND i.status IN ('open','reserved') AND i.archived_at IS NULL
      AND i.custody = NEW.custody AND NEW.returned_on >= i.occurred_on
      AND ((i.custody = 'campus' AND a.role = 'admin') OR (i.custody = 'finder' AND i.author_id = a.id))
      AND (i.reserved_contact_id IS NULL OR i.reserved_contact_id = NEW.contact_id)
      AND (i.reserved_lost_id IS NULL OR i.reserved_lost_id = NEW.lost_id)
  ) THEN RAISE(ABORT,'return_item_unavailable') END;
  SELECT CASE WHEN NEW.lost_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM items l JOIN items f ON f.id = NEW.item_id
    WHERE l.id = NEW.lost_id AND l.kind = 'lost' AND l.archived_at IS NULL AND l.status = 'open'
      AND l.author_id = NEW.recipient_id AND l.category_id = f.category_id
      AND (l.recovery_for_id IS NULL OR l.recovery_for_id = f.id)
  ) THEN RAISE(ABORT,'return_lost_unavailable') END;
  SELECT CASE WHEN NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.item_id = NEW.item_id
      AND c.requester_id = NEW.recipient_id AND c.lost_id = NEW.lost_id AND c.status IN ('pending','approved')
  ) THEN RAISE(ABORT,'return_contact_unavailable') END;
END;

CREATE TRIGGER returns_complete AFTER INSERT ON returns BEGIN
  UPDATE items SET status = 'returned', updated_by = NEW.actor_id, updated_at = NEW.created_at,
    reservation_name = NULL, reserved_contact_id = NULL, reserved_lost_id = NULL WHERE id = NEW.item_id;
  UPDATE items SET status = 'recovered', updated_by = NEW.actor_id, updated_at = NEW.created_at WHERE id = NEW.lost_id;
  UPDATE contacts SET status = CASE WHEN id = NEW.contact_id OR (lost_id = NEW.lost_id AND item_id = NEW.item_id)
      THEN 'delivered' ELSE 'rejected' END, updated_at = NEW.created_at
    WHERE status IN ('pending','approved') AND (item_id = NEW.item_id OR lost_id = NEW.lost_id);
  UPDATE items SET status = 'open', updated_by = NEW.actor_id, updated_at = NEW.created_at,
    reservation_name = NULL, reserved_contact_id = NULL, reserved_lost_id = NULL
    WHERE status = 'reserved' AND reserved_lost_id = NEW.lost_id;
END;

CREATE TRIGGER rating_validate BEFORE INSERT ON ratings BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM returns r JOIN items i ON i.id = r.item_id JOIN users u ON u.id = NEW.user_id AND u.active = 1
    WHERE r.item_id = NEW.item_id AND
      ((NEW.perspective = 'recipient' AND r.recipient_id = NEW.user_id) OR
       (NEW.perspective = 'finder' AND i.author_id = NEW.user_id AND r.recipient_id IS NOT NEW.user_id))
  ) THEN RAISE(ABORT,'rating_not_allowed') END;
END;

INSERT INTO settings(id) VALUES (1);
INSERT INTO categories(id,name) VALUES
  ('eletronicos','Eletrônicos'), ('documentos','Documentos'), ('acessorios','Acessórios'),
  ('material-escolar','Material escolar'), ('roupas','Roupas'), ('outros','Outros');
INSERT INTO locations(id,name) VALUES
  ('laboratorio','Laboratório de Informática 3'), ('cantina','Cantina'), ('estacionamento','Estacionamento'),
  ('biblioteca','Biblioteca'), ('sala','Sala de aula'), ('corredor','Corredor'), ('secretaria','Secretaria'),
  ('quadra','Quadra'), ('patio','Pátio'), ('outro','Outro local');
