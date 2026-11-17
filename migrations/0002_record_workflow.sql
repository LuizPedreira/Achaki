CREATE INDEX IF NOT EXISTS contacts_lost_status ON contacts(lost_id, status);
CREATE INDEX IF NOT EXISTS items_open_reservations ON items(reserved_lost_id)
  WHERE status = 'reserved' AND archived_at IS NULL;
