-- ============================================================
-- TERMIN-ANFRAGEN ZWISCHEN NUTZERN
-- Ein Nutzer ("Initiator") schlägt einen Termin vor und lädt
-- einen oder MEHRERE andere Nutzer gleichzeitig ein.
-- Jeder Empfänger antwortet einzeln mit Zu- oder Absage.
-- Der Initiator bestätigt/verwirft die Anfrage nach Eingang
-- der Rückmeldungen. Bei Bestätigung wird daraus ein "echter"
-- Termin in einem Kalender des Initiators (target_calendar_id).
-- ============================================================

-- ── 1. Tabellen ─────────────────────────────────────────────

create table if not exists public.termin_requests (
  id                  uuid primary key default uuid_generate_v4(),
  created_by          uuid not null references public.profiles(id) on delete cascade,
  target_calendar_id  uuid references public.calendars(id) on delete set null,
  title               text not null,
  description         text,
  location            text,
  date                date not null,
  date_end            date,
  time                time,
  time_end            time,
  color               text,
  status              text not null default 'open'
                        check (status in ('open', 'confirmed', 'cancelled')),
  confirmed_event_id  uuid references public.events(id) on delete set null,
  created_at          timestamptz default now(),
  confirmed_at        timestamptz,
  cancelled_at        timestamptz
);

create table if not exists public.termin_request_recipients (
  id           uuid primary key default uuid_generate_v4(),
  request_id   uuid not null references public.termin_requests(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  response     text not null default 'pending'
                 check (response in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  created_at   timestamptz default now(),
  unique (request_id, user_id)
);


-- ── 2. Indizes ──────────────────────────────────────────────
create index if not exists idx_trq_created_by   on public.termin_requests(created_by);
create index if not exists idx_trq_status       on public.termin_requests(status);
create index if not exists idx_trqr_request     on public.termin_request_recipients(request_id);
create index if not exists idx_trqr_user        on public.termin_request_recipients(user_id);


-- ── 3. Row Level Security aktivieren ───────────────────────
alter table public.termin_requests            enable row level security;
alter table public.termin_request_recipients  enable row level security;


-- ── 4. Hilfsfunktion ───────────────────────────────────────
-- Gibt true zurück, wenn der aktuelle Nutzer Empfänger der Anfrage ist.
create or replace function public.is_termin_request_recipient(p_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.termin_request_recipients
    where request_id = p_request_id
      and user_id = auth.uid()
  );
$$;


-- ── 5. RLS-Policies: termin_requests ───────────────────────

-- Sehen: Initiator ODER Empfänger der Anfrage
drop policy if exists "trq: sehen" on public.termin_requests;
create policy "trq: sehen"
  on public.termin_requests for select
  using (
    created_by = auth.uid()
    or public.is_termin_request_recipient(id)
  );

-- Erstellen: nur als Initiator
drop policy if exists "trq: erstellen" on public.termin_requests;
create policy "trq: erstellen"
  on public.termin_requests for insert
  with check (auth.uid() = created_by);

-- Ändern (Status, Bestätigung, Zielkalender): nur Initiator
drop policy if exists "trq: bearbeiten" on public.termin_requests;
create policy "trq: bearbeiten"
  on public.termin_requests for update
  using (created_by = auth.uid());

-- Löschen: nur Initiator
drop policy if exists "trq: löschen" on public.termin_requests;
create policy "trq: löschen"
  on public.termin_requests for delete
  using (created_by = auth.uid());


-- ── 6. RLS-Policies: termin_request_recipients ─────────────

-- Sehen: Nur wenn Teil der Anfrage (Initiator oder Empfänger).
drop policy if exists "trqr: sehen" on public.termin_request_recipients;
create policy "trqr: sehen"
  on public.termin_request_recipients for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.termin_requests r
      where r.id = request_id and r.created_by = auth.uid()
    )
  );

-- Empfänger hinzufügen: darf nur der Initiator der Anfrage.
drop policy if exists "trqr: einladen" on public.termin_request_recipients;
create policy "trqr: einladen"
  on public.termin_request_recipients for insert
  with check (
    exists (
      select 1 from public.termin_requests r
      where r.id = request_id and r.created_by = auth.uid()
    )
  );

-- Antwort ändern: nur der Empfänger selbst (Zu-/Absage).
drop policy if exists "trqr: antworten" on public.termin_request_recipients;
create policy "trqr: antworten"
  on public.termin_request_recipients for update
  using (user_id = auth.uid());

-- Entfernen: Initiator der Anfrage (oder Empfänger zieht sich selbst raus).
drop policy if exists "trqr: entfernen" on public.termin_request_recipients;
create policy "trqr: entfernen"
  on public.termin_request_recipients for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.termin_requests r
      where r.id = request_id and r.created_by = auth.uid()
    )
  );
