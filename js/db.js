// ============================================================
// DB.JS – Alle Datenbankoperationen øber Supabase
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

/** Alle Kalender laden, bei denen der Nutzer Mitglied ist */
export async function getCalendars(userId) {
  const { data, error } = await supabase
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
  if (error) throw error;

  return (data ?? []).map(row => ({
    ...row.calendars,
    myRole: row.role,
    myStatus: row.status,
  }));
}

/** Einen Kalender mit allen Mitgliedern und Terminen laden */
export async function getCalendarDetails(calendarId) {
  const [calRes, membersRes, eventsRes] = await Promise.all([
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
  ]);
  if (calRes.error) throw calRes.error;
  return {
    ...calRes.data,
    members: membersRes.data ?? [],
    events:  eventsRes.data ?? [],
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

/** Alle Termine eines Nutzers mit Rollenzuweisung laden */
export async function getMyEvents(userId) {
  const { data, error } = await supabase
    .from('event_roles')
    .select(`
      name,
      events (
        id, title, date, time, color, calendar_id,
        calendars (name, color)
      )
    `)
    .eq('assigned_user_id', userId)
    .gte('events.date', new Date().toISOString().split('T')[0])
    .order('events(date)', { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? [])
    .filter(r => r.events)
    .map(r => ({
      ...r.events,
      calName:    r.events.calendars?.name,
      calColor:   r.events.calendars?.color,
      myRoleName: r.name,
    }));
}
