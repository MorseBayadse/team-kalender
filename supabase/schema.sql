-- ============================================================
-- TEAM KALENDER APP – Supabase Datenbankschema
-- Dieses Script einmal im Supabase SQL-Editor ausführen
-- ============================================================

-- ── 1. Erweiterungen ────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── 2. Tabellen ─────────────────────────────────────────────

-- Nutzerprofile (verknüpft mit dem Auth-System von Supabase)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  firstname   text not null,
  lastname    text not null,
  avatar      text not null,          -- Initialen, z.B. "MM"
  created_at  timestamptz default now()
);

-- Kalender
create table if not exists public.calendars (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  description text,
  color       text not null default '#5B5FEF',
  visibility  text not null default 'team'
                check (visibility in ('private', 'team', 'public')),
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz default now()
);

-- Kalendermitglieder
create table if not exists public.calendar_members (
  id          uuid primary key default uuid_generate_v4(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member'
                check (role in ('owner', 'admin', 'member')),
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined')),
  joined_at   timestamptz default now(),
  unique (calendar_id, user_id)
);

-- Termine / Events
create table if not exists public.events (
  id          uuid primary key default uuid_generate_v4(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  title       text not null,
  description text,
  location    text,
  date        date not null,
  date_end    date,
  time        time,
  time_end    time,
  color       text,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz default now()
);

-- Rollen pro Termin (z.B. "Moderator: Max Mustermann")
create table if not exists public.event_roles (
  id               uuid primary key default uuid_generate_v4(),
  event_id         uuid not null references public.events(id) on delete cascade,
  name             text not null,
  assigned_user_id uuid references public.profiles(id) on delete set null
);


-- ── 3. Indizes für Performance ──────────────────────────────
create index if not exists idx_calendar_members_user    on public.calendar_members(user_id);
create index if not exists idx_calendar_members_cal     on public.calendar_members(calendar_id);
create index if not exists idx_events_calendar          on public.events(calendar_id);
create index if not exists idx_events_date              on public.events(date);
create index if not exists idx_event_roles_event        on public.event_roles(event_id);


-- ── 4. Row Level Security aktivieren ───────────────────────
alter table public.profiles         enable row level security;
alter table public.calendars        enable row level security;
alter table public.calendar_members enable row level security;
alter table public.events           enable row level security;
alter table public.event_roles      enable row level security;


-- ── 5. Hilfsfunktionen (SECURITY DEFINER umgeht RLS) ────────
-- Verhindert Endlosrekursion in Policies die calendar_members abfragen

create or replace function public.get_my_calendar_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select calendar_id from public.calendar_members
  where user_id = auth.uid() and status = 'accepted';
$$;

create or replace function public.is_calendar_admin(p_calendar_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.calendar_members
    where calendar_id = p_calendar_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
      and status = 'accepted'
  );
$$;

create or replace function public.get_event_calendar_id(p_event_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select calendar_id from public.events where id = p_event_id;
$$;


-- ── 6. RLS-Policies: profiles ───────────────────────────────
create policy "profiles: jeder kann lesen"
  on public.profiles for select
  using (auth.uid() is not null);

create policy "profiles: nur eigene anlegen"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: nur eigene bearbeiten"
  on public.profiles for update
  using (auth.uid() = id);


-- ── 7. RLS-Policies: calendars ──────────────────────────────
create policy "calendars: sehen"
  on public.calendars for select
  using (
    visibility = 'public'
    or created_by = auth.uid()
    or id in (select public.get_my_calendar_ids())
  );

create policy "calendars: erstellen"
  on public.calendars for insert
  with check (auth.uid() is not null and auth.uid() = created_by);

create policy "calendars: bearbeiten"
  on public.calendars for update
  using (public.is_calendar_admin(id));

create policy "calendars: löschen"
  on public.calendars for delete
  using (created_by = auth.uid());


-- ── 8. RLS-Policies: calendar_members ──────────────────────
create policy "members: sehen"
  on public.calendar_members for select
  using (
    user_id = auth.uid()
    or calendar_id in (select public.get_my_calendar_ids())
  );

create policy "members: einladen"
  on public.calendar_members for insert
  with check (
    public.is_calendar_admin(calendar_id)
    or (auth.uid() = user_id and role = 'owner')
  );

create policy "members: status ändern"
  on public.calendar_members for update
  using (user_id = auth.uid());

create policy "members: entfernen"
  on public.calendar_members for delete
  using (
    user_id = auth.uid()
    or public.is_calendar_admin(calendar_id)
  );


-- ── 9. RLS-Policies: events ────────────────────────────────
create policy "events: sehen"
  on public.events for select
  using (calendar_id in (select public.get_my_calendar_ids()));

create policy "events: erstellen"
  on public.events for insert
  with check (
    auth.uid() = created_by
    and calendar_id in (select public.get_my_calendar_ids())
  );

create policy "events: bearbeiten"
  on public.events for update
  using (
    created_by = auth.uid()
    or public.is_calendar_admin(calendar_id)
  );

create policy "events: löschen"
  on public.events for delete
  using (
    created_by = auth.uid()
    or public.is_calendar_admin(calendar_id)
  );


-- ── 10. RLS-Policies: event_roles ──────────────────────────
create policy "event_roles: sehen"
  on public.event_roles for select
  using (
    public.get_event_calendar_id(event_id) in (select public.get_my_calendar_ids())
  );

create policy "event_roles: verwalten"
  on public.event_roles for all
  using (
    public.get_event_calendar_id(event_id) in (select public.get_my_calendar_ids())
  );


-- ── 11. Automatisches Profil beim Registrieren anlegen ──────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, firstname, lastname, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'firstname', 'Nutzer'),
    coalesce(new.raw_user_meta_data->>'lastname', ''),
    coalesce(new.raw_user_meta_data->>'avatar', 'NU')
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
