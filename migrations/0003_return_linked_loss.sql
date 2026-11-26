-- Uma perda pode ter sido cadastrada em outra categoria pela pessoa que perdeu o item.
DROP TRIGGER returns_validate;
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
      AND l.author_id = NEW.recipient_id
      AND (l.recovery_for_id IS NULL OR l.recovery_for_id = f.id)
  ) THEN RAISE(ABORT,'return_lost_unavailable') END;
  SELECT CASE WHEN NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.item_id = NEW.item_id
      AND c.requester_id = NEW.recipient_id AND c.lost_id = NEW.lost_id AND c.status IN ('pending','approved')
  ) THEN RAISE(ABORT,'return_contact_unavailable') END;
END;
