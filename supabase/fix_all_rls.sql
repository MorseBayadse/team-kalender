-- ============================================================
-- KOMPLETTER RLS-FIX: Alle Policies rekursionsfrei machen
--
-- Problem: calendar_members Policies referenzieren sich selbst
-- → "infinite recursion detected in policy for relation calendar_members"
--
-- Lösung: SECURITY DEFINER Funktionen umgehen RLS und brechen
-- die Rekursion. Alle Policies nutzen diese Funktionen.
-- ============================================================

-- ── 1. HILFSFUNKTIONEN (SECURITY DEFINER = umgeht RLS) ──────

-- Gibt alle Calendar-IDs zurück, bei denen der Nutzer akzeptiertes Mitglied ist
CREATE OR REPLACE FUNCTION public.get_my_calendar_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT calendar_id FROM public.calendar_members
  WHERE user_id = auth.uid() AND status = 'accepted';
$$;

-- Prüft ob der Nutzer Owner oder Admin eines Kalenders ist
CREATE OR REPLACE FUNCTION public.is_calendar_admin(p_calendar_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calendar_members
    WHERE calendar_id = p_calendar_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND status = 'accepted'
  );
$$;

-- Gibt die calendar_id eines Events zurück (für event_roles Policies)
CREATE OR REPLACE FUNCTION public.get_event_calendar_id(p_event_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT calendar_id FROM public.events WHERE id = p_event_id;
$$;


-- ── 2. ALLE ALTEN POLICIES LÖSCHEN ─────────────────────────

-- calendars
DROP POLICY IF EXISTS "calendars: nur eigene sehen" ON public.calendars;
DROP POLICY IF EXISTS "calendars: eingeloggte können erstellen" ON public.calendars;
DROP POLICY IF EXISTS "calendars: nur owner/admin können bearbeiten" ON public.calendars;
DROP POLICY IF EXISTS "calendars: nur owner kann löschen" ON public.calendars;

-- calendar_members
DROP POLICY IF EXISTS "members: nur sehen wenn Mitglied" ON public.calendar_members;
DROP POLICY IF EXISTS "members: nur owner/admin können einladen" ON public.calendar_members;
DROP POLICY IF EXISTS "members: eigenen Status ändern" ON public.calendar_members;
DROP POLICY IF EXISTS "members: owner/admin oder selbst entfernen" ON public.calendar_members;

-- events
DROP POLICY IF EXISTS "events: nur Mitglieder sehen" ON public.events;
DROP POLICY IF EXISTS "events: Mitglieder können erstellen" ON public.events;
DROP POLICY IF EXISTS "events: Ersteller/Admin/Owner können bearbeiten" ON public.events;
DROP POLICY IF EXISTS "events: Ersteller/Admin/Owner können löschen" ON public.events;

-- event_roles
DROP POLICY IF EXISTS "event_roles: Mitglieder können sehen" ON public.event_roles;
DROP POLICY IF EXISTS "event_roles: Ersteller/Admin können verwalten" ON public.event_roles;


-- ── 3. NEUE POLICIES: calendars ─────────────────────────────

CREATE POLICY "calendars: sehen"
  ON public.calendars FOR SELECT
  USING (
    visibility = 'public'
    OR created_by = auth.uid()
    OR id IN (SELECT public.get_my_calendar_ids())
  );

CREATE POLICY "calendars: erstellen"
  ON public.calendars FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = created_by
  );

CREATE POLICY "calendars: bearbeiten"
  ON public.calendars FOR UPDATE
  USING (public.is_calendar_admin(id));

CREATE POLICY "calendars: löschen"
  ON public.calendars FOR DELETE
  USING (created_by = auth.uid());


-- ── 4. NEUE POLICIES: calendar_members ──────────────────────

-- SELECT: eigene Einträge + Einträge in Kalendern wo ich Mitglied bin
CREATE POLICY "members: sehen"
  ON public.calendar_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR calendar_id IN (SELECT public.get_my_calendar_ids())
  );

-- INSERT: Owner/Admin können einladen, ODER Selbst-Eintrag als Owner bei neuem Kalender
CREATE POLICY "members: einladen"
  ON public.calendar_members FOR INSERT
  WITH CHECK (
    public.is_calendar_admin(calendar_id)
    OR (auth.uid() = user_id AND role = 'owner')
  );

-- UPDATE: nur eigenen Status ändern (accept/decline)
CREATE POLICY "members: status ändern"
  ON public.calendar_members FOR UPDATE
  USING (user_id = auth.uid());

-- DELETE: selbst austreten oder Owner/Admin entfernt Mitglied
CREATE POLICY "members: entfernen"
  ON public.calendar_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.is_calendar_admin(calendar_id)
  );


-- ── 5. NEUE POLICIES: events ────────────────────────────────

CREATE POLICY "events: sehen"
  ON public.events FOR SELECT
  USING (calendar_id IN (SELECT public.get_my_calendar_ids()));

CREATE POLICY "events: erstellen"
  ON public.events FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND calendar_id IN (SELECT public.get_my_calendar_ids())
  );

CREATE POLICY "events: bearbeiten"
  ON public.events FOR UPDATE
  USING (
    created_by = auth.uid()
    OR public.is_calendar_admin(calendar_id)
  );

CREATE POLICY "events: löschen"
  ON public.events FOR DELETE
  USING (
    created_by = auth.uid()
    OR public.is_calendar_admin(calendar_id)
  );


-- ── 6. NEUE POLICIES: event_roles ───────────────────────────

CREATE POLICY "event_roles: sehen"
  ON public.event_roles FOR SELECT
  USING (
    public.get_event_calendar_id(event_id) IN (SELECT public.get_my_calendar_ids())
  );

CREATE POLICY "event_roles: verwalten"
  ON public.event_roles FOR ALL
  USING (
    public.get_event_calendar_id(event_id) IN (SELECT public.get_my_calendar_ids())
  );
