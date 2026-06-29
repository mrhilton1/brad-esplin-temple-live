-- An event appointment is uniquely identified by its visible schedule slot.
-- Gemini may extract child-to-parent participant text differently across uploads,
-- so guest text cannot be the stable identity key.
create unique index if not exists temple_events_unique_slot_idx
  on public.temple_events (event_date, event_time, room);
