-- Existing event ids were generated from extracted guest text, which made them
-- long, unstable, and difficult to inspect in Supabase. Keep the text primary
-- key shape for the current Worker API, but store UUID strings for events.
create extension if not exists pgcrypto;

create temporary table event_id_migration_map as
select id as old_id, gen_random_uuid()::text as new_id
from public.temple_events
where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

update public.temple_sync_conflicts c
set contact_id = m.new_id,
    updated_at = now()
from event_id_migration_map m
where c.contact_id = m.old_id
  and c.sheet_type = 'event_schedule';

update public.temple_events e
set id = m.new_id,
    updated_at = now()
from event_id_migration_map m
where e.id = m.old_id;
