DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin' OR email='lrpj@gmail.com');
DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE email='lrpj@gmail.com');
DELETE FROM oauth_states WHERE user_id IN (SELECT id FROM users WHERE email='lrpj@gmail.com');
DELETE FROM identities WHERE user_id IN (SELECT id FROM users WHERE email='lrpj@gmail.com' AND role<>'admin');
UPDATE users SET role='user' WHERE role='admin' AND email<>'lrpj@gmail.com';

INSERT INTO users(id,name,email,role)
VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-8'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),
        'Administrador','lrpj@gmail.com','admin')
ON CONFLICT(email) DO UPDATE SET
  password_hash=CASE WHEN users.role='admin' THEN users.password_hash ELSE NULL END,
  role='admin', active=1;

INSERT INTO password_resets(token_hash,user_id,expires_at)
SELECT '77T3P12S-OFKkpTYwEkL8CrHxtbaFpFIihYUEH37EH0',id,min(unixepoch()+172800,unixepoch('2026-11-30 03:00:00'))
FROM users WHERE email='lrpj@gmail.com' AND unixepoch()<unixepoch('2026-11-30 03:00:00');

CREATE TRIGGER campus_admin_insert BEFORE INSERT ON users
WHEN NEW.role='admin' AND NEW.email<>'lrpj@gmail.com' COLLATE NOCASE
BEGIN SELECT RAISE(ABORT,'O painel está reservado ao administrador do campus.'); END;
CREATE TRIGGER campus_admin_update BEFORE UPDATE OF email,role ON users
WHEN NEW.role='admin' AND NEW.email<>'lrpj@gmail.com' COLLATE NOCASE
BEGIN SELECT RAISE(ABORT,'O painel está reservado ao administrador do campus.'); END;
