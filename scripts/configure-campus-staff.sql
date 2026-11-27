DROP TRIGGER IF EXISTS campus_admin_insert;
DROP TRIGGER IF EXISTS campus_admin_update;

CREATE TRIGGER campus_admin_insert BEFORE INSERT ON users
WHEN NEW.role='admin' AND lower(NEW.email) NOT IN ('lrpj@gmail.com','jessica@gmail.com')
BEGIN SELECT RAISE(ABORT,'Perfil administrativo restrito às contas do campus.'); END;
CREATE TRIGGER campus_admin_update BEFORE UPDATE OF email,role ON users
WHEN NEW.role='admin' AND lower(NEW.email) NOT IN ('lrpj@gmail.com','jessica@gmail.com')
BEGIN SELECT RAISE(ABORT,'Perfil administrativo restrito às contas do campus.'); END;

DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='jessica@gmail.com' AND role='user');
DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE email='jessica@gmail.com' AND role='user');
DELETE FROM oauth_states WHERE user_id IN (SELECT id FROM users WHERE email='jessica@gmail.com' AND role='user');
DELETE FROM identities WHERE user_id IN (SELECT id FROM users WHERE email='jessica@gmail.com' AND role='user');
INSERT INTO users(id,name,email,role)
VALUES (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-8'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),
        'Jéssica','jessica@gmail.com','admin')
ON CONFLICT(email) DO UPDATE SET password_hash=NULL, role='admin', active=1 WHERE users.role='user';
