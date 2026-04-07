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


-- ── 5. RLS-Policies: profiles ───────────────────────────────
-- Jeder eingeloggte Nutzer kann alle Profile lesen (für Einladungen nötig)
create policy "profiles: jeder kann lesen"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Nur du selbst kannst dein Profil anlegen/bearbeiten
create policy "profiles: nur eigene anlegen"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: nur eigene bearbeiten"
  on public.profiles for update
  using (auth.uid() = id);


-- ── 6. RLS-Policies: calendars ──────────────────────────────
-- Sehen: nur Kalender bei denen du Mitglied bist (oder öffentliche)
create policy "calendars: nur eigene sehen"
  on public.calendars for select
  using (
    visibility = 'public'
    or exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = id
        and cm.user_id = auth.uid()
        and cm.status = 'accepted'
    )
  );

-- Erstellen: jeder eingeloggte Nutzer
create policy "calendars: eingeloggte können erstellen"
  on public.calendars for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by);

-- Bearbeiten: nur Owner oder Admin
create policy "calendars: nur owner/admin können bearbeiten"
  on public.calendars for update
  using (
    exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = id
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'accepted'
    )
  );

-- Löschen: nur Owner
create policy "calendars: nur owner kann löschen"
  on public.calendars for delete
  using (created_by = auth.uid());


-- ── 7. RLS-Policies: calendar_members ──────────────────────
-- Sehen: nur wenn du selbst Mitglied dieses Kalenders bist
create policy "members: nur sehen wenn Mitglied"
  on public.calendar_members for select
  using (
    exists (
      select 1 from public.calendar_members cm2
      where cm2.calendar_id = calendar_id
        and cm2.user_id = auth.uid()
        and cm2.status = 'accepted'
    )
    or user_id = auth.uid()   -- eigene pending-Einladungen sehen
  );

-- Einladen: nur Owner oder Admin
create policy "members: nur owner/admin können einladen"
  on public.calendar_members for insert
  with check (
    exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = calendar_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'accepted'
    )
    or (
      -- Owner-Eintrag beim Erstellen eines neuen Kalenders erlaubt
      auth.uid() = user_id and role = 'owner'
    )
  );

-- Status ändern (accept/decline): nur du selbst für deine eigene Einladung
create policy "members: eigenen Status ändern"
  on public.calendar_members for update
  using (user_id = auth.uid());

-- Entfernen: Owner/Admin können entfernen, oder du selbst (austreten)
create policy "members: owner/admin oder selbst entfernen"
  on public.calendar_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = calendar_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'accepted'
    )
  );


-- ── 8. RLS-Policies: events ─────────────────────────────────
-- Sehen: Mitglieder des Kalenders
create policy "events: nur Mitglieder sehen"
  on public.events for select
  using (
    exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = calendar_id
        and cm.user_id = auth.uid()
        and cm.status = 'accepted'
    )
  );

-- Erstellen: akzeptierte Mitglieder
create policy "events: Mitglieder können erstellen"
  on public.events for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = calendar_id
        and cm.user_id = auth.uid()
        and cm.status = 'accepted'
    )
  );

-- Bearbeiten: Ersteller, Admin oder Owner
create policy "events: Ersteller/Admin/Owner können bearbeiten"
  on public.events for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = calendar_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'accepted'
    )
  );

-- Löschen: Ersteller, Admin oder Owner
create policy "events: Ersteller/Admin/Owner können löschen"
  on public.events for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = calendar_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'accepted'
    )
  );


-- ── 9. RLS-Policies: event_roles ───────────────────────────
create policy "event_roles: Mitglieder können sehen"
  on public.event_roles for select
  using (
    exists (
      select 1 from public.events e
      join public.calendar_members cm on cm.calendar_id = e.calendar_id
      where e.id = event_id
        and cm.user_id = auth.uid()
        and cm.status = 'accepted'
    )
  );

create policy "event_roles: Ersteller/Admin können verwalten"
  on public.event_roles for all
  using (
    exists (
      select 1 from public.events e
      join public.calendar_members cm on cm.calendar_id = e.calendar_id
      where e.id = event_id
        and cm.user_id = auth.uid()
        and (e.created_by = auth.uid() or cm.role in ('owner', 'admin'))
        and cm.status = 'accepted'
    )
  );


-- ── 10. Automatisches Profil beim Registrieren anlegen ──────
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
