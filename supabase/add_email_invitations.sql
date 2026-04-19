-- ============================================================
-- E-MAIL-EINLADUNGEN FÜR NICHT-REGISTRIERTE NUTZER
-- Dieses Script im Supabase SQL-Editor ausführen
-- ============================================================

-- ── 1. Tabelle: pending_invitations ─────────────────────────
-- Speichert Einladungen an E-Mail-Adressen, die noch kein Konto haben.
-- Sobald sich der Nutzer registriert, werden die Einladungen
-- automatisch in calendar_members umgewandelt.

create table if not exists public.pending_invitations (
  id           uuid primary key default uuid_generate_v4(),
  email        text not null,
  calendar_id  uuid not null references public.calendars(id) on delete cascade,
  role         text not null default 'member'
                 check (role in ('admin', 'member')),
  invited_by   uuid not null references public.profiles(id) on delete cascade,
  token        text not null unique,
  created_at   timestamptz default now(),
  -- Keine doppelten Einladungen pro E-Mail + Kalender
  unique (email, calendar_id)
);

create index if not exists idx_pending_invitations_email
  on public.pending_invitations(email);
create index if not exists idx_pending_invitations_token
  on public.pending_invitations(token);

-- ── 2. RLS aktivieren ───────────────────────────────────────
alter table public.pending_invitations enable row level security;

-- Admins/Owner des Kalenders dürfen Einladungen sehen und erstellen
create policy "pending_invitations: sehen"
  on public.pending_invitations for select
  using (
    public.is_calendar_admin(calendar_id)
    or invited_by = auth.uid()
  );

create policy "pending_invitations: erstellen"
  on public.pending_invitations for insert
  with check (
    public.is_calendar_admin(calendar_id)
  );

create policy "pending_invitations: löschen"
  on public.pending_invitations for delete
  using (
    public.is_calendar_admin(calendar_id)
    or invited_by = auth.uid()
  );

-- ── 3. RPC: Nutzer per E-Mail finden ────────────────────────
-- Sucht in auth.users nach der E-Mail und gibt das Profil zurück.
-- Security definer, damit wir auth.users lesen können.

create or replace function public.find_user_by_email(p_email text)
returns table (id uuid, firstname text, lastname text, avatar text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select p.id, p.firstname, p.lastname, p.avatar
    from auth.users u
    join public.profiles p on p.id = u.id
    where lower(u.email) = lower(p_email)
    limit 1;
end;
$$;

-- ── 4. Funktion: Pending-Einladungen nach Registrierung verarbeiten
-- Wird vom Trigger aufgerufen, wenn ein neuer User erstellt wird.
-- Sucht alle pending_invitations für die E-Mail des neuen Users
-- und wandelt sie in calendar_members um.

create or replace function public.process_pending_invitations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  -- Alle offenen Einladungen für diese E-Mail verarbeiten
  for inv in
    select * from public.pending_invitations
    where lower(email) = lower(new.email)
  loop
    -- Nur einfügen, wenn nicht schon Mitglied
    insert into public.calendar_members (calendar_id, user_id, role, status)
    values (inv.calendar_id, new.id, inv.role, 'pending')
    on conflict (calendar_id, user_id) do nothing;

    -- Einladung löschen
    delete from public.pending_invitations where id = inv.id;
  end loop;

  return new;
end;
$$;

-- Trigger: nach jedem neuen User die Einladungen prüfen
drop trigger if exists on_user_process_invitations on auth.users;
create trigger on_user_process_invitations
  after insert on auth.users
  for each row execute procedure public.process_pending_invitations();

-- ── 5. RPC: Einladung per Token abrufen (für Landing Page) ──
create or replace function public.get_invitation_by_token(p_token text)
returns table (
  id uuid,
  email text,
  calendar_name text,
  calendar_color text,
  inviter_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      pi.id,
      pi.email,
      c.name as calendar_name,
      c.color as calendar_color,
      (p.firstname || ' ' || p.lastname) as inviter_name,
      pi.created_at
    from public.pending_invitations pi
    join public.calendars c on c.id = pi.calendar_id
    join public.profiles p on p.id = pi.invited_by
    where pi.token = p_token
    limit 1;
end;
$$;
