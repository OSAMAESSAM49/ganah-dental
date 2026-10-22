-- Ganah Dental — Supabase setup (run once in Supabase → SQL Editor → New query → Run).
--
-- The app stays offline-first: every device keeps its own IndexedDB copy and syncs changes
-- through one generic table. Each row mirrors one local record (store + id + JSON data).
-- Images go to the private Storage bucket "media". Only signed-in members of a clinic can
-- read or write that clinic's rows (Row Level Security).

-- 1. Clinics and who may access them -------------------------------------------------------
create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

-- 2. Synced records ----------------------------------------------------------------------------
create table if not exists public.records (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  store text not null,
  id text not null,
  data jsonb,                      -- the local record (null when deleted)
  deleted boolean not null default false,
  client_updated_at text,          -- record.updatedAt from the device (newest wins)
  device_id text,
  server_updated_at timestamptz not null default now(),  -- pull cursor (set by the server)
  primary key (clinic_id, store, id)
);
create index if not exists records_pull_idx on public.records (clinic_id, server_updated_at);

-- The server clock decides the pull cursor, so devices with a wrong clock still sync.
create or replace function public.touch_record() returns trigger language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_record();

-- Upsert that keeps the newest version (by the device's updatedAt) when two devices edit the same record.
create or replace function public.push_records(p_clinic uuid, p_rows jsonb) returns integer
language plpgsql security invoker as $$
declare n integer;
begin
  insert into public.records as r (clinic_id, store, id, data, deleted, client_updated_at, device_id)
  select p_clinic, x.store, x.id, x.data, coalesce(x.deleted, false), x.client_updated_at, x.device_id
  from jsonb_to_recordset(p_rows) as x(store text, id text, data jsonb, deleted boolean, client_updated_at text, device_id text)
  on conflict (clinic_id, store, id) do update
    set data = excluded.data, deleted = excluded.deleted,
        client_updated_at = excluded.client_updated_at, device_id = excluded.device_id
    where coalesce(r.client_updated_at, '') <= coalesce(excluded.client_updated_at, '');
  get diagnostics n = row_count;
  return n;
end $$;

-- 3. Row Level Security ------------------------------------------------------------------------
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.records enable row level security;

create or replace function public.is_member(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid());
$$;

drop policy if exists "members read clinic" on public.clinics;
create policy "members read clinic" on public.clinics for select using (public.is_member(id));

drop policy if exists "members read membership" on public.clinic_members;
create policy "members read membership" on public.clinic_members for select using (user_id = auth.uid());

drop policy if exists "members read records" on public.records;
create policy "members read records" on public.records for select using (public.is_member(clinic_id));
drop policy if exists "members insert records" on public.records;
create policy "members insert records" on public.records for insert with check (public.is_member(clinic_id));
drop policy if exists "members update records" on public.records;
create policy "members update records" on public.records for update using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));
-- No delete policy: deletions are synced as tombstones (deleted = true).

-- 4. Images (private bucket, one folder per clinic) --------------------------------------------
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict (id) do nothing;

drop policy if exists "members read media" on storage.objects;
create policy "members read media" on storage.objects for select
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members write media" on storage.objects;
create policy "members write media" on storage.objects for insert
  with check (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members update media" on storage.objects;
create policy "members update media" on storage.objects for update
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));

