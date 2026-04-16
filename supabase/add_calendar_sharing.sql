-- ============================================================
-- Team-Kalender: Cross-Calendar Sharing
-- Ermöglicht Admins eines Kalenders, ihn mit einem anderen
-- Kalender zu teilen. Mitglieder des Ziel-Kalenders können dann
-- die Termine des Quell-Kalenders LESEN (aber nicht bearbeiten).
--
-- Dieses Script einmal im Supabase SQL-Editor ausführen,
-- NACHDEM schema.sql bereits ausgeführt wurde.
-- ============================================================

-- ── 1. Neue Tabelle: calendar_shares ────────────────────────
create table if not exists public.calendar_shares (
  id                  uuid primary key default uuid_generate_v4(),
  source_calendar_id  uuid not null references public.calendars(id) on delete cascade,
  target_calendar_id  uuid not null references public.calendars(id) on delete cascade,
  shared_by           uuid not null references public.profiles(id)  on delete cascade,
  created_at          timestamptz default now(),
  unique (source_calendar_id, target_calendar_id),
  check (source_calendar_id <> target_calendar_id)
);

create index if not exists idx_shares_source on public.calendar_shares(source_calendar_id);
create index if not exists idx_shares_target on public.calendar_shares(target_calendar_id);

alter table public.calendar_shares enable row level security;


-- ── 2. Hilfsfunktion: Alle Kalender, die ich LESEN darf ─────
--     (eigene Mitgliedschaften + von anderen Kalendern geteilte)
create or replace function public.get_my_readable_calendar_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  -- Kalender, deren akzeptiertes Mitglied ich bin
  select calendar_id
    from public.calendar_members
   where user_id = auth.uid() and status = 'accepted'
  union
  -- Kalender, die mit einem meiner Kalender geteilt wurden
  select cs.source_calendar_id
    from public.calendar_shares cs
   where cs.target_calendar_id in (
     select calendar_id
       from public.calendar_members
      where user_id = auth.uid() and status = 'accepted'
   );
$$;


-- ── 3. RLS für calendars erweitern ──────────────────────────
drop policy if exists "calendars: sehen" on public.calendars;
create policy "calendars: sehen"
  on public.calendars for select
  using (
    visibility = 'public'
    or created_by = auth.uid()
    or id in (select public.get_my_readable_calendar_ids())
  );


-- ── 4. RLS für events erweitern (Lesen via Share) ──────────
drop policy if exists "events: sehen" on public.events;
create policy "events: sehen"
  on public.events for select
  using (calendar_id in (select public.get_my_readable_calendar_ids()));

-- Schreiben/Ändern/Löschen bleibt EINGESCHRÄNKT auf echte Mitglieder
-- (also nicht via Share möglich) — die bestehenden insert/update/delete
-- Policies bleiben unverändert. Dadurch ist "geteilt = read-only"
-- auch auf Datenbank-Ebene garantiert.


-- ── 5. RLS für event_roles erweitern ───────────────────────
drop policy if exists "event_roles: sehen" on public.event_roles;
create policy "event_roles: sehen"
  on public.event_roles for select
  using (
    public.get_event_calendar_id(event_id) in (select public.get_my_readable_calendar_ids())
  );


-- ── 6. RLS für calendar_members (Mitglieder geteilter Kalender sichtbar) ─
drop policy if exists "members: sehen" on public.calendar_members;
create policy "members: sehen"
  on public.calendar_members for select
  using (
    user_id = auth.uid()
    or calendar_id in (select public.get_my_readable_calendar_ids())
  );


-- ── 7. RLS für calendar_shares selbst ──────────────────────
drop policy if exists "shares: sehen"    on public.calendar_shares;
drop policy if exists "shares: erstellen" on public.calendar_shares;
drop policy if exists "shares: löschen"  on public.calendar_shares;

-- Sehen: beteiligte Kalender (als Quelle oder Ziel) müssen zu meinen gehören
create policy "shares: sehen"
  on public.calendar_shares for select
  using (
    source_calendar_id in (select public.get_my_calendar_ids())
    or target_calendar_id in (select public.get_my_calendar_ids())
  );

-- Erstellen: nur Admins/Ersteller des Quell-Kalenders dürfen teilen
-- und müssen selbst Mitglied des Ziel-Kalenders sein (Missbrauchsschutz)
create policy "shares: erstellen"
  on public.calendar_shares for insert
  with check (
    public.is_calendar_admin(source_calendar_id)
    and target_calendar_id in (select public.get_my_calendar_ids())
    and shared_by = auth.uid()
  );

-- Löschen: Admin des Quell-Kalenders darf Freigabe zurückziehen
create policy "shares: löschen"
  on public.calendar_shares for delete
  using (public.is_calendar_admin(source_calendar_id));
