alter table public.temple_events
  add column if not exists lsg_reminded boolean not null default false,
  add column if not exists groom_lsg_reminded boolean not null default false,
  add column if not exists csg_reminded boolean not null default false;
