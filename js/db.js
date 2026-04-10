// ============================================================
// DB.JS – Alle Datenbankoperationen über Supabase
// Ersetzt das alte localStorage-basierte DB-Objekt vollständig
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── AUTH ─────────────────────────────────────────────────────

/** Registrierung: Konto anlegen + Profil speichern */
export async function signUp(firstname, lastname, email, password) {
  const avatar = (firstname[0] + lastname[0]).toUpperCase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { firstname, lastname, avatar } }
  });
  if (error) throw error;
  return data.user;
}

/** Anmeldung */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/** Abmeldung */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Aktuellen Nutzer + Profil laden */
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) return null;
  return { ...user, ...profile };
}

/** Auf Auth-Änderungen hören (Login / Logout) */
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}


// ── PROFILE ──────────────────────────────────────────────────

/** Alle Profile laden (für Mitglieder-Suche und Anzeige) */
export async function getProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, firstname, lastname, avatar');
  if (error) throw error;
  return data ?? [];
}

/** Einzelnes Profil per E-Mail suchen (für Einladungen) */
export async function findProfileByEmail(email) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, firstname, lastname, avatar')
    .eq('id', (
      await supabase
        .from('auth.users')
        .select('id')
        .eq('email', email)
        .single()
    )?.data?.id ?? '');
  if (error || !data?.length) return null;
  return data[0];
}

/** Nutzer per Auth-E-Mail über RPC suchen */
export async function findUserByEmail(email) {
  const { data, error } = await supabase.rpc('find_user_by_email', { p_email: email });
  if (error || !data) return null;
  return data;
}


// ── KALENDER ─────────────────────────────────────────────────

/**
 * Alle Kalender laden, bei denen der Nutzer Mitglied ist,
 * plus alle Kalender, die mit einem seiner Kalender geteilt wurden
 * (read-only). Geteilte Kalender werden mit isShared=true, readOnly=true
 * und myStatus='accepted' markiert.
 */
export async function getCalendars(userId) {
  // 1) Eigene Mitgliedschaften
  const { data: memberRows, error: memberErr } = await supabase
    .from('calendar_members')
    .select(`
      role,
      status,
      joined_at,
      calendars (
        id, name, description, color, visibility, created_by, created_at
      )
    `)
    .eq('user_id', userId)
    .in('status', ['accepted', 'pending']);
  if (memberErr) throw memberErr;

  const owned = (memberRows ?? []).map(row => ({
    ...row.calendars,
    myRole:   row.role,
    myStatus: row.status,
    isShared: false,
    readOnly: false,
  }));

  // 2) Kalender, die mit meinen Kalendern geteilt wurden
  const myCalIds = owned
    .filter(c => c.myStatus === 'accepted')
    .map(c => c.id);

  let shared = [];
  const ownedIds = new Set(owned.map(c => c.id));
  const seen = new Set();

  const pushShared = (cal, extra = {}) => {
    if (!cal) return;
    if (ownedIds.has(cal.id)) return;
    if (seen.has(cal.id)) return;
    seen.add(cal.id);
    shared.push({
      ...cal,
      myRole:   'viewer',
      myStatus: 'accepted',
      isShared: true,
      readOnly: true,
      ...extra,
    });
  };

  // 2a) an einen meiner Kalender geteilt
  if (myCalIds.length) {
    const { data: shareRows, error: shareErr } = await supabase
      .from('calendar_shares')
      .select(`
        source_calendar_id,
        target_calendar_id,
        calendars:source_calendar_id (
          id, name, description, color, visibility, created_by, created_at, is_personal
        )
      `)
      .in('target_calendar_id', myCalIds);
    if (!shareErr && shareRows) {
      for (const row of shareRows) {
        pushShared(row.calendars, { sharedViaCalendarId: row.target_calendar_id });
      }
    }
  }

  // 2b) direkt an mich als Nutzer geteilt (landet im privaten Kalender)
  {
    const { data: userShares, error: usErr } = await supabase
      .from('calendar_shares')
      .select(`
        source_calendar_id,
        target_user_id,
        calendars:source_calendar_id (
          id, name, description, color, visibility, created_by, created_at, is_personal
        )
      `)
      .eq('target_user_id', userId);
    if (!usErr && userShares) {
      for (const row of userShares) {
        pushShared(row.calendars, { sharedToUser: true });
      }
    }
  }

  return [...owned, ...shared];
}

// ── SHARING: Kalender ─────────────────────────────────────────

/** Einen Kalender mit einem anderen Kalender teilen (read-only für dessen Mitglieder). */
export async function shareCalendarWith(sourceCalendarId, targetCalendarId, sharedBy) {
  const { data, error } = await supabase
    .from('calendar_shares')
    .insert({
      source_calendar_id: sourceCalendarId,
      target_calendar_id: targetCalendarId,
      shared_by:          sharedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Einen Kalender direkt mit einem Nutzer teilen (→ dessen privater Kalender). */
export async function shareCalendarWithUser(sourceCalendarId, targetUserId, sharedBy) {
  const { data, error } = await supabase
    .from('calendar_shares')
    .insert({
      source_calendar_id: sourceCalendarId,
      target_user_id:     targetUserId,
      shared_by:          sharedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Freigabe zurückziehen. */
export async function unshareCalendar(shareId) {
  const { error } = await supabase
    .from('calendar_shares')
    .delete()
    .eq('id', shareId);
  if (error) throw error;
}

/** Alle Freigaben eines Kalenders (wem er geteilt wurde – Kalender UND Nutzer). */
export async function getCalendarSharesOf(sourceCalendarId) {
  const { data, error } = await supabase
    .from('calendar_shares')
    .select(`
      id,
      target_calendar_id,
      target_user_id,
      created_at,
      calendars:target_calendar_id (id, name, color),
      profiles:target_user_id      (id, firstname, lastname, avatar)
    `)
    .eq('source_calendar_id', sourceCalendarId);
  if (error) return [];
  return data ?? [];
}

// ── SHARING: Einzelne Termine ────────────────────────────────

/** Termin an einen Nutzer teilen (→ sein privater Kalender). */
export async function shareEventWithUser(eventId, targetUserId, sharedBy) {
  const { data, error } = await supabase
    .from('event_shares')
    .insert({ event_id: eventId, target_user_id: targetUserId, shared_by: sharedBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Termin an einen Team-Kalender weiterteilen. Voraussetzung: Nutzer ist dort Mitglied. */
export async function shareEventWithCalendar(eventId, targetCalendarId, sharedBy) {
  const { data, error } = await supabase
    .from('event_shares')
    .insert({ event_id: eventId, target_calendar_id: targetCalendarId, shared_by: sharedBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Freigabe eines Termins zurückziehen. */
export async function unshareEvent(eventShareId) {
  const { error } = await supabase.from('event_shares').delete().eq('id', eventShareId);
  if (error) throw error;
}

/** Alle Freigaben eines Termins. */
export async function getEventSharesOf(eventId) {
  const { data, error } = await supabase
    .from('event_shares')
    .select(`
      id, target_calendar_id, target_user_id, created_at,
      calendars:target_calendar_id (id, name, color),
      profiles:target_user_id      (id, firstname, lastname, avatar)
    `)
    .eq('event_id', eventId);
  if (error) return [];
  return data ?? [];
}

/** Alle Termine, die via event_shares für mich sichtbar sind
 *  (entweder direkt an mich als Nutzer oder an einen meiner Team-Kalender).
 *  Wird auf Client-Seite gebündelt mit den "echten" Events eines Kalenders gerendert.
 *  Rückgabe: [{share_id, target_calendar_id, target_user_id, event:{…}}]
 */
export async function getEventsSharedToMe(userId, myCalendarIds) {
  // Zwei Abfragen: an mich direkt + an meine Kalender.
  const [byUser, byCal] = await Promise.all([
    supabase
      .from('event_shares')
      .select(`id, target_calendar_id, target_user_id,
               events(*, event_roles(*), calendars(id,name,color))`)
      .eq('target_user_id', userId),
    myCalendarIds?.length
      ? supabase
          .from('event_shares')
          .select(`id, target_calendar_id, target_user_id,
                   events(*, event_roles(*), calendars(id,name,color))`)
          .in('target_calendar_id', myCalendarIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const rows = [...(byUser.data ?? []), ...(byCal.data ?? [])];
  return rows.filter(r => r.events);
}

// ── SHARE-HIDES (Empfänger verbirgt Freigabe) ────────────────

export async function hideCalendarShare(calendarShareId, userId) {
  const { error } = await supabase
    .from('share_hides')
    .insert({ user_id: userId, calendar_share_id: calendarShareId });
  if (error) throw error;
}

export async function hideEventShare(eventShareId, userId) {
  const { error } = await supabase
    .from('share_hides')
    .insert({ user_id: userId, event_share_id: eventShareId });
  if (error) throw error;
}

export async function getMyHides(userId) {
  const { data, error } = await supabase
    .from('share_hides')
    .select('id, calendar_share_id, event_share_id')
    .eq('user_id', userId);
  if (error) return { cal: new Set(), evt: new Set() };
  return {
    cal: new Set((data ?? []).filter(r => r.calendar_share_id).map(r => r.calendar_share_id)),
    evt: new Set((data ?? []).filter(r => r.event_share_id).map(r => r.event_share_id)),
  };
}

// ── ICS-ABO (Outlook / Apple Calendar) ──────────────────────

/** Aktiven ICS-Token des Nutzers holen (oder null). */
export async function getIcsSubscription(userId) {
  const { data, error } = await supabase
    .from('ics_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) return null;
  return data;
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Neuen ICS-Token erzeugen (alten revoken). Rückgabe: { token, url }. */
export async function createIcsSubscription(userId) {
  // Alten Eintrag (falls vorhanden) komplett entfernen – user_id hat unique constraint
  await supabase.from('ics_subscriptions').delete().eq('user_id', userId);
  const token = randomToken();
  const { data, error } = await supabase
    .from('ics_subscriptions')
    .insert({ user_id: userId, token })
    .select()
    .single();
  if (error) throw error;
  const base = SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
  return { ...data, url: `${base}/ics?token=${token}` };
}

/** Token löschen / deaktivieren. */
export async function revokeIcsSubscription(userId) {
  const { error } = await supabase
    .from('ics_subscriptions')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

/** URL zu einem existierenden Token berechnen. */
export function icsUrl(token) {
  const base = SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co');
  return `${base}/ics?token=${token}`;
}

// ── PRIVATER KALENDER ────────────────────────────────────────

/** Sicherstellen, dass der Nutzer einen privaten Kalender hat (Backfill für Altnutzer). */
export async function ensurePersonalCalendar(userId) {
  // Client-seitiger Versuch, RPC funktioniert nach Migration.
  try {
    const { data, error } = await supabase.rpc('ensure_personal_calendar', { p_user_id: userId });
    if (!error && data) return data;
  } catch (_) {}
  // Fallback: direkter Insert (falls RPC nicht erreichbar)
  const { data: existing } = await supabase
    .from('calendars')
    .select('id')
    .eq('created_by', userId)
    .eq('is_personal', true)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: cal, error: calErr } = await supabase
    .from('calendars')
    .insert({
      name: 'Mein Kalender',
      description: 'Privater Kalender',
      color: '#5B5FEF',
      visibility: 'private',
      created_by: userId,
      is_personal: true,
    })
    .select()
    .single();
  if (calErr) throw calErr;
  await supabase
    .from('calendar_members')
    .insert({ calendar_id: cal.id, user_id: userId, role: 'owner', status: 'accepted' });
  return cal.id;
}

/** Einen Kalender mit allen Mitgliedern und Terminen laden.
 *  Inkludiert auch Termine, die via event_shares in diesen Kalender
 *  (bzw. in den privaten Kalender des aktuellen Nutzers) hereingeteilt wurden.
 *  Hereingeteilte Termine werden mit __shared=true markiert (read-only).
 */
export async function getCalendarDetails(calendarId) {
  const [calRes, membersRes, eventsRes, userRes] = await Promise.all([
    supabase.from('calendars').select('*').eq('id', calendarId).single(),
    supabase
      .from('calendar_members')
      .select('*, profiles(id, firstname, lastname, avatar)')
      .eq('calendar_id', calendarId),
    supabase
      .from('events')
      .select('*, event_roles(*)')
      .eq('calendar_id', calendarId)
      .order('date', { ascending: true }),
    supabase.auth.getUser(),
  ]);
  if (calRes.error) throw calRes.error;

  const cal = calRes.data;
  const me  = userRes.data?.user;
  const events = [...(eventsRes.data ?? [])];

  // Termine, die an diesen Kalender hereingeteilt wurden
  try {
    const { data: calSharedIn } = await supabase
      .from('event_shares')
      .select(`id, shared_by, events(*, event_roles(*))`)
      .eq('target_calendar_id', calendarId);
    for (const row of (calSharedIn ?? [])) {
      if (row.events) events.push({ ...row.events, __shared: true, __shareId: row.id });
    }
  } catch (_) {}

  // Falls der Kalender privat ist: auch Termine, die direkt an mich geteilt wurden
  if (cal.is_personal && me?.id) {
    try {
      const { data: userSharedIn } = await supabase
        .from('event_shares')
        .select(`id, shared_by, events(*, event_roles(*))`)
        .eq('target_user_id', me.id);
      for (const row of (userSharedIn ?? [])) {
        if (row.events) events.push({ ...row.events, __shared: true, __shareId: row.id });
      }
    } catch (_) {}
  }

  // Nach Datum sortieren
  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return {
    ...cal,
    members: membersRes.data ?? [],
    events,
  };
}

/** Neuen Kalender erstellen */
export async function createCalendar(userId, { name, description, color, visibility }) {
  // 1. Kalender anlegen
  const { data: cal, error: calErr } = await supabase
    .from('calendars')
    .insert({ name, description, color, visibility, created_by: userId })
    .select()
    .single();
  if (calErr) throw calErr;

  // 2. Ersteller automatisch als Owner eintragen
  const { error: memberErr } = await supabase
    .from('calendar_members')
    .insert({ calendar_id: cal.id, user_id: userId, role: 'owner', status: 'accepted' });
  if (memberErr) throw memberErr;

  return cal;
}

/** Kalender bearbeiten */
export async function updateCalendar(calendarId, updates) {
  const { data, error } = await supabase
    .from('calendars')
    .update(updates)
    .eq('id', calendarId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Kalender löschen */
export async function deleteCalendar(calendarId) {
  const { error } = await supabase.from('calendars').delete().eq('id', calendarId);
  if (error) throw error;
}


// ── MITGLIEDER ───────────────────────────────────────────────

/** Mitglied einladen (per Profil-ID) */
export async function inviteMember(calendarId, profileId, role = 'member') {
  const { data, error } = await supabase
    .from('calendar_members')
    .insert({ calendar_id: calendarId, user_id: profileId, role, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Einladung annehmen */
export async function acceptInvite(calendarId, userId) {
  const { error } = await supabase
    .from('calendar_members')
    .update({ status: 'accepted', joined_at: new Date().toISOString() })
    .eq('calendar_id', calendarId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Einladung ablehnen / Mitglied entfernen */
export async function removeMember(calendarId, userId) {
  const { error } = await supabase
    .from('calendar_members')
    .delete()
    .eq('calendar_id', calendarId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Rolle eines Mitglieds ändern */
export async function updateMemberRole(calendarId, userId, newRole) {
  const { error } = await supabase
    .from('calendar_members')
    .update({ role: newRole })
    .eq('calendar_id', calendarId)
    .eq('user_id', userId);
  if (error) throw error;
}


// ── TERMINE ──────────────────────────────────────────────────

/** Termin erstellen */
export async function createEvent(userId, calendarId, eventData) {
  const { roles, ...rest } = eventData;

  const { data: ev, error: evErr } = await supabase
    .from('events')
    .insert({ ...rest, calendar_id: calendarId, created_by: userId })
    .select()
    .single();
  if (evErr) throw evErr;

  // Rollen speichern
  if (roles?.length) {
    const roleRows = roles.map(r => ({
      event_id: ev.id,
      name: r.name,
      assigned_user_id: r.assignedUserId ?? null,
    }));
    const { error: roleErr } = await supabase.from('event_roles').insert(roleRows);
    if (roleErr) throw roleErr;
  }
  return ev;
}

/** Termin bearbeiten */
export async function updateEvent(eventId, eventData) {
  const { roles, ...rest } = eventData;

  const { data: ev, error: evErr } = await supabase
    .from('events')
    .update(rest)
    .eq('id', eventId)
    .select()
    .single();
  if (evErr) throw evErr;

  // Rollen neu setzen: erst löschen, dann neu einfügen
  await supabase.from('event_roles').delete().eq('event_id', eventId);
  if (roles?.length) {
    const roleRows = roles.map(r => ({
      event_id: eventId,
      name: r.name,
      assigned_user_id: r.assignedUserId ?? null,
    }));
    await supabase.from('event_roles').insert(roleRows);
  }
  return ev;
}

/** Termin löschen */
export async function deleteEvent(eventId) {
  const { error } = await supabase.from('events').delete().eq('id', eventId);
  if (error) throw error;
}

/** Alle Termine eines Nutzers, in die er „involviert" ist.
 *
 *  Regel (vom Nutzer definiert):
 *   – Termin in einem Kalender, in dem ich akzeptiertes Mitglied bin:
 *      • ohne jegliche Rollen  →  gilt für ALLE Mitglieder (also auch für mich)
 *      • mit Rollen            →  gilt nur, wenn mir mindestens eine Rolle zugewiesen ist
 *   – Jeder Termin, der direkt an mich geteilt wurde (event_shares.target_user_id = me)
 *   – Jeder Termin, der in einen meiner Kalender weitergeteilt wurde
 *     (event_shares.target_calendar_id in meinen Kalendern)
 *
 *  Rückgabe: Zukünftige Termine (ab heute), nach Datum sortiert.
 */
export async function getMyEvents(userId) {
  const today = new Date().toISOString().split('T')[0];

  // 1) Meine Kalender-IDs (akzeptierte Mitgliedschaft)
  const { data: memberRows } = await supabase
    .from('calendar_members')
    .select('calendar_id')
    .eq('user_id', userId)
    .eq('status', 'accepted');
  const myCalIds = (memberRows ?? []).map(r => r.calendar_id);

  // 2) Alle kommenden Termine aus meinen Kalendern
  let ownEvents = [];
  if (myCalIds.length) {
    const { data: evs } = await supabase
      .from('events')
      .select('*, event_roles(*), calendars(name,color)')
      .in('calendar_id', myCalIds)
      .gte('date', today)
      .order('date', { ascending: true });
    ownEvents = (evs ?? []).filter(ev => {
      const roles = ev.event_roles ?? [];
      if (roles.length === 0) return true;                          // gilt allen
      return roles.some(r => r.assigned_user_id === userId);        // gilt mir
    }).map(ev => {
      const myRole = (ev.event_roles ?? []).find(r => r.assigned_user_id === userId);
      return {
        ...ev,
        calName:    ev.calendars?.name,
        calColor:   ev.calendars?.color,
        myRoleName: myRole?.name ?? null,
      };
    });
  }

  // 3) Termine, die direkt an mich oder an meinen Kalender geteilt wurden
  let sharedIn = [];
  try {
    const { data: byUser } = await supabase
      .from('event_shares')
      .select(`id, events(*, event_roles(*), calendars(name,color))`)
      .eq('target_user_id', userId);
    for (const row of (byUser ?? [])) {
      if (row.events && row.events.date >= today) {
        sharedIn.push({
          ...row.events,
          calName:    row.events.calendars?.name,
          calColor:   row.events.calendars?.color,
          __shared:   true,
          __shareId:  row.id,
        });
      }
    }
    if (myCalIds.length) {
      const { data: byCal } = await supabase
        .from('event_shares')
        .select(`id, events(*, event_roles(*), calendars(name,color))`)
        .in('target_calendar_id', myCalIds);
      for (const row of (byCal ?? [])) {
        if (row.events && row.events.date >= today) {
          sharedIn.push({
            ...row.events,
            calName:    row.events.calendars?.name,
            calColor:   row.events.calendars?.color,
            __shared:   true,
            __shareId:  row.id,
          });
        }
      }
    }
  } catch (_) {}

  // 4) Dedupe per Event-ID, sortieren, limitieren
  const map = new Map();
  for (const e of [...ownEvents, ...sharedIn]) {
    if (!map.has(e.id)) map.set(e.id, e);
  }
  return Array.from(map.values())
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') ||
                    ((a.time || '') > (b.time || '') ? 1 : -1))
    .slice(0, 40);
}
