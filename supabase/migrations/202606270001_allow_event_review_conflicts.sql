-- Review Center stores both contact conflicts and event schedule review items in
-- temple_sync_conflicts. Event review item ids are synthetic event ids, not
-- temple_contacts ids, so this column cannot enforce a contact-only foreign key.
alter table public.temple_sync_conflicts
  drop constraint if exists temple_sync_conflicts_contact_id_fkey;
