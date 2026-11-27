DROP TRIGGER audit_item_update;
ALTER TABLE items ADD COLUMN item_description TEXT NOT NULL DEFAULT '' CHECK (length(item_description) <= 1200);
UPDATE items SET item_description = description;
ALTER TABLE items DROP COLUMN description;
ALTER TABLE items RENAME COLUMN item_description TO description;

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
