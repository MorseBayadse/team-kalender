-- ============================================================
-- Team-Kalender: ICS-Abonnement (Outlook / Apple Calendar)
--
-- Pro Nutzer eine geheime Token-URL, über die externe Kalender
-- die persönlichen Termine im iCalendar-Format (.ics) abonnieren.
--
-- Dieses Script EINMAL im Supabase SQL-Editor ausführen
-- (nach add_personal_and_event_sharing.sql).
-- Die Edge-Function `ics` muss separat deployed werden.
-- ============================================================

create table if not exists public.ics_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null unique references public.profiles(id) on delete cascade,
  token       text not null unique,
  created_at  timestamptz default now(),
  revoked_at  timestamptz
);

create index if not exists idx_ics_subs_token on public.ics_subscriptions(token);

alter table public.ics_subscriptions enable row level security;

drop policy if exists "ics_subs: eigene sehen"     on public.ics_subscriptions;
drop policy if exists "ics_subs: eigene erstellen" on public.ics_subscriptions;
drop policy if exists "ics_subs: eigene updaten"   on public.ics_subscriptions;
drop policy if exists "ics_subs: eigene löschen"   on public.ics_subscriptions;

create policy "ics_subs: eigene sehen"
  on public.ics_subscriptions for select
  using (user_id = auth.uid());

create policy "ics_subs: eigene erstellen"
  on public.ics_subscriptions for insert
  with check (user_id = auth.uid());

create policy "ics_subs: eigene updaten"
  on public.ics_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "ics_subs: eigene löschen"
  on public.ics_subscriptions for delete
  using (user_id = auth.uid());
