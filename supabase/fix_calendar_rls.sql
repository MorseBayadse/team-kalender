-- ============================================================
-- FIX: Kalender-Erstellung schlägt fehl wegen RLS-Policy
--
-- Problem: Die SELECT-Policy auf "calendars" verlangt, dass der
-- Nutzer bereits Mitglied (calendar_members) ist. Beim Erstellen
-- wird aber zuerst der Kalender angelegt und DANN der Owner-
-- Eintrag in calendar_members geschrieben. Da Supabase bei
-- INSERT ... RETURNING auch die SELECT-Policy prüft, schlägt
-- der INSERT fehl.
--
-- Lösung: Dem Ersteller (created_by) erlauben, seinen eigenen
-- Kalender immer zu sehen.
--
-- Ausführen im Supabase SQL-Editor (https://supabase.com/dashboard)
-- ============================================================

-- 1. Alte SELECT-Policy entfernen
drop policy if exists "calendars: nur eigene sehen" on public.calendars;

-- 2. Neue SELECT-Policy mit created_by-Check
create policy "calendars: nur eigene sehen"
  on public.calendars for select
  using (
    visibility = 'public'
    or created_by = auth.uid()
    or exists (
      select 1 from public.calendar_members cm
      where cm.calendar_id = id
        and cm.user_id = auth.uid()
        and cm.status = 'accepted'
    )
  );
