-- ============================================================
-- Team-Kalender: Privater Kalender + Personen-Sharing + Termin-Sharing
--
-- Dieses Script einmal im Supabase SQL-Editor ausführen,
-- NACHDEM schema.sql und add_calendar_sharing.sql bereits
-- ausgeführt wurden.
--
-- Neu:
--  1) Jeder Nutzer hat einen automatischen PRIVATEN KALENDER
--     ("Mein Kalender"), is_personal = true.
--  2) calendar_shares kann zusätzlich an einen einzelnen NUTZER
--     geteilt werden (target_user_id) statt an einen Kalender.
--     Solche Freigaben erscheinen im privaten Kalender des Empfängers.
--  3) Neue Tabelle event_shares: einzelner Termin kann an einen
--     Nutzer (→ sein privater Kalender) oder an einen Team-Kalender
--     weitergeteilt werden (read-only). Jeder akzeptierte Mitglieds-
--     nutzer darf das.
--  4) Neue Tabelle share_hides: Empfänger kann geteilte Inhalte
--     verbergen / ablehnen.
-- ============================================================


-- ── 1. Privat-Flag an calendars ─────────────────────────────
alter table public.calendars
  add column if not exists is_personal boolean not null default false;

-- Nur ein privater Kalender pro Nutzer
create unique index if not exists uniq_personal_per_user
  on public.calendars(created_by)
  where is_personal;


-- ── 2. Funktion: privaten Kalender für einen Nutzer anlegen ─
create or replace function public.ensure_personal_calendar(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cal_id uuid;
begin
  select id into v_cal_id
    from public.calendars
   where created_by = p_user_id and is_personal = true
   limit 1;

  if v_cal_id is null then
    insert into public.calendars (name, description, color, visibility, created_by, is_personal)
    values ('Mein Kalender', 'Privater Kalender', '#5B5FEF', 'private', p_user_id, true)
    returning id into v_cal_id;

    insert into public.calendar_members (calendar_id, user_id, role, status, joined_at)
    values (v_cal_id, p_user_id, 'owner', 'accepted', now())
    on conflict do nothing;
  end if;

  return v_cal_id;
end;
$$;


-- ── 3. handle_new_user erweitern: Profil + privater Kalender ─
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
  )
  on conflict (id) do nothing;

  perform public.ensure_personal_calendar(new.id);
  return new;
end;
$$;


-- ── 4. Backfill: für bestehende Nutzer privaten Kalender anlegen ─
do $$
declare r record;
begin
  for r in select id from public.profiles loop
    perform public.ensure_personal_calendar(r.id);
  end loop;
end $$;


-- ── 5. calendar_shares: optional an einen Nutzer teilen ─────
alter table public.calendar_shares
  alter column target_calendar_id drop not null;

alter table public.calendar_shares
  add column if not exists target_user_id uuid
  references public.profiles(id) on delete cascade;

-- genau EIN Ziel (Kalender ODER Nutzer)
alter table public.calendar_shares
  drop constraint if exists calendar_shares_one_target;
alter table public.calendar_shares
  add constraint calendar_shares_one_target
  check (
    (target_calendar_id is not null and target_user_id is null)
    or (target_calendar_id is null and target_user_id is not null)
  );

-- Eindeutigkeit pro Ziel
drop index if exists idx_calendar_shares_unique_cal;
drop index if exists idx_calendar_shares_unique_user;
create unique index idx_calendar_shares_unique_cal
  on public.calendar_shares(source_calendar_id, target_calendar_id)
  where target_calendar_id is not null;
create unique index idx_calendar_shares_unique_user
  on public.calendar_shares(source_calendar_id, target_user_id)
  where target_user_id is not null;

create index if not exists idx_shares_target_user
  on public.calendar_shares(target_user_id);


-- ── 6. Neue Tabelle: event_shares ───────────────────────────
create table if not exists public.event_shares (
  id                  uuid primary key default uuid_generate_v4(),
  event_id            uuid not null references public.events(id) on delete cascade,
  target_calendar_id  uuid references public.calendars(id) on delete cascade,
  target_user_id      uuid references public.profiles(id)  on delete cascade,
  shared_by           uuid not null references public.profiles(id) on delete cascade,
  created_at          timestamptz default now(),
  constraint event_shares_one_target check (
    (target_calendar_id is not null and target_user_id is null)
    or (target_calendar_id is null and target_user_id is not null)
  )
);

create unique index if not exists idx_event_shares_unique_cal
  on public.event_shares(event_id, target_calendar_id)
  where target_calendar_id is not null;
create unique index if not exists idx_event_shares_unique_user
  on public.event_shares(event_id, target_user_id)
  where target_user_id is not null;

create index if not exists idx_event_shares_event  on public.event_shares(event_id);
create index if not exists idx_event_shares_tcal   on public.event_shares(target_calendar_id);
create index if not exists idx_event_shares_tuser  on public.event_shares(target_user_id);

alter table public.event_shares enable row level security;


-- ── 7. Neue Tabelle: share_hides (Empfänger verbirgt Freigabe) ─
create table if not exists public.share_hides (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  calendar_share_id uuid references public.calendar_shares(id) on delete cascade,
  event_share_id    uuid references public.event_shares(id)    on delete cascade,
  created_at        timestamptz default now(),
  constraint share_hides_one_target check (
    (calendar_share_id is not null and event_share_id is null)
    or (calendar_share_id is null and event_share_id is not null)
  )
);

create unique index if not exists idx_share_hides_cal
  on public.share_hides(user_id, calendar_share_id)
  where calendar_share_id is not null;
create unique index if not exists idx_share_hides_evt
  on public.share_hides(user_id, event_share_id)
  where event_share_id is not null;

alter table public.share_hides enable row level security;


-- ── 8. Helfer: meine privaten + eigenen Kalender-IDs (als member) ─
-- (get_my_calendar_ids existiert bereits in schema.sql)

-- Helfer: gilt ein event als für mich lesbar via event_share?
create or replace function public.can_read_event_via_share(p_event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.event_shares es
     where es.event_id = p_event_id
       and (
         es.target_user_id = auth.uid()
         or es.target_calendar_id in (
           select calendar_id from public.calendar_members
            where user_id = auth.uid() and status = 'accepted'
         )
       )
  );
$$;


-- ── 9. get_my_readable_calendar_ids erweitern ───────────────
--     Jetzt auch: Kalender, die direkt an mich als Nutzer geteilt wurden
create or replace function public.get_my_readable_calendar_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  -- eigene Mitgliedschaften
  select calendar_id
    from public.calendar_members
   where user_id = auth.uid() and status = 'accepted'
  union
  -- an einen meiner Kalender geteilt
  select cs.source_calendar_id
    from public.calendar_shares cs
   where cs.target_calendar_id in (
     select calendar_id
       from public.calendar_members
      where user_id = auth.uid() and status = 'accepted'
   )
  union
  -- direkt an mich als Nutzer geteilt
  select cs.source_calendar_id
    from public.calendar_shares cs
   where cs.target_user_id = auth.uid();
$$;


-- ── 10. events-SELECT Policy: auch via event_shares lesbar ──
drop policy if exists "events: sehen" on public.events;
create policy "events: sehen"
  on public.events for select
  using (
    calendar_id in (select public.get_my_readable_calendar_ids())
    or public.can_read_event_via_share(id)
  );


-- ── 11. event_roles-SELECT Policy: auch via event_share lesbar ─
drop policy if exists "event_roles: sehen" on public.event_roles;
create policy "event_roles: sehen"
  on public.event_roles for select
  using (
    public.get_event_calendar_id(event_id) in (select public.get_my_readable_calendar_ids())
    or public.can_read_event_via_share(event_id)
  );


-- ── 12. RLS für event_shares ────────────────────────────────
drop policy if exists "event_shares: sehen"      on public.event_shares;
drop policy if exists "event_shares: erstellen"  on public.event_shares;
drop policy if exists "event_shares: löschen"    on public.event_shares;

-- Sehen: Teilender, Zielnutzer, Mitglieder des Ziel-Kalenders, oder wer
-- Mitglied des Quell-Kalenders des Events ist.
create policy "event_shares: sehen"
  on public.event_shares for select
  using (
    shared_by = auth.uid()
    or target_user_id = auth.uid()
    or (target_calendar_id is not null
        and target_calendar_id in (
          select calendar_id from public.calendar_members
           where user_id = auth.uid() and status = 'accepted'
        ))
    or public.get_event_calendar_id(event_id) in (
        select calendar_id from public.calendar_members
         where user_id = auth.uid() and status = 'accepted'
    )
  );

-- Erstellen: Nutzer muss Mitglied des Quell-Kalenders des Events sein.
-- Ziel-Kalender: muss selbst auch Mitglied dort sein.
-- Ziel-Nutzer: jeder Profil-Eintrag erlaubt.
create policy "event_shares: erstellen"
  on public.event_shares for insert
  with check (
    shared_by = auth.uid()
    and public.get_event_calendar_id(event_id) in (
      select calendar_id from public.calendar_members
       where user_id = auth.uid() and status = 'accepted'
    )
    and (
      target_user_id is not null
      or target_calendar_id in (
        select calendar_id from public.calendar_members
         where user_id = auth.uid() and status = 'accepted'
      )
    )
  );

-- Löschen: Teilender selbst oder Admin des Quell-Kalenders
create policy "event_shares: löschen"
  on public.event_shares for delete
  using (
    shared_by = auth.uid()
    or public.is_calendar_admin(public.get_event_calendar_id(event_id))
  );


-- ── 13. calendar_shares: insert policy für Ziel-Nutzer ──────
drop policy if exists "shares: sehen"     on public.calendar_shares;
drop policy if exists "shares: erstellen" on public.calendar_shares;
drop policy if exists "shares: löschen"   on public.calendar_shares;

create policy "shares: sehen"
  on public.calendar_shares for select
  using (
    source_calendar_id in (select public.get_my_calendar_ids())
    or (target_calendar_id is not null
        and target_calendar_id in (select public.get_my_calendar_ids()))
    or target_user_id = auth.uid()
    or shared_by = auth.uid()
  );

create policy "shares: erstellen"
  on public.calendar_shares for insert
  with check (
    public.is_calendar_admin(source_calendar_id)
    and shared_by = auth.uid()
    and (
      (target_calendar_id is not null
       and target_calendar_id in (select public.get_my_calendar_ids()))
      or target_user_id is not null
    )
  );

create policy "shares: löschen"
  on public.calendar_shares for delete
  using (public.is_calendar_admin(source_calendar_id));


-- ── 14. RLS für share_hides ─────────────────────────────────
drop policy if exists "share_hides: sehen"     on public.share_hides;
drop policy if exists "share_hides: erstellen" on public.share_hides;
drop policy if exists "share_hides: löschen"   on public.share_hides;

create policy "share_hides: sehen"
  on public.share_hides for select
  using (user_id = auth.uid());

create policy "share_hides: erstellen"
  on public.share_hides for insert
  with check (user_id = auth.uid());

create policy "share_hides: löschen"
  on public.share_hides for delete
  using (user_id = auth.uid());


-- ── 15. Privaten Kalender vor Löschen schützen ──────────────
drop policy if exists "calendars: löschen" on public.calendars;
create policy "calendars: löschen"
  on public.calendars for delete
  using (
    created_by = auth.uid()
    and is_personal = false
  );
