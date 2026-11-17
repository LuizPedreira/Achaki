CREATE INDEX contacts_lost_status ON contacts(lost_id, status);
CREATE INDEX items_open_reservations ON items(reserved_lost_id)
  WHERE status = 'reserved' AND archived_at IS NULL;
