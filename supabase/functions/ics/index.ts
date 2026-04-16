// Supabase Edge Function: ics
//
// Liefert die "persönlichen Termine" eines Nutzers im
// iCalendar-Format (text/calendar), damit Outlook / Apple Calendar
// / Google Calendar den Feed als Abonnement einbinden können.
//
// Deploy (ein Mal):
//   supabase functions deploy ics --no-verify-jwt
//
// Aufruf:
//   https://<PROJECT>.functions.supabase.co/ics?token=<TOKEN>
//
// Der Token wird pro Nutzer in public.ics_subscriptions gespeichert
// und kann jederzeit neu erzeugt werden.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Ev = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  date: string;
  date_end: string | null;
  time: string | null;
  time_end: string | null;
  event_roles: { assigned_user_id: string | null }[];
  calendars: { name: string | null } | null;
};

const ICS_ESC = (s: unknown) =>
  (s ?? "")
    .toString()
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const fmtDate     = (d: string)            => d.replaceAll("-", "");
const fmtDateTime = (d: string, t: string) => `${fmtDate(d)}T${t.replace(":", "")}00`;

function fold(line: string): string {
  // RFC 5545: Zeilen >75 Oktette müssen gefaltet werden
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  chunks.push(line.slice(i, i + 75));
  i += 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Token → user_id
  const { data: sub, error: subErr } = await supa
    .from("ics_subscriptions")
    .select("user_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (subErr || !sub || sub.revoked_at) {
    return new Response("Invalid or revoked token", { status: 404 });
  }
  const userId = sub.user_id;

  // 2) Meine Kalender-IDs
  const { data: memberRows } = await supa
    .from("calendar_members")
    .select("calendar_id")
    .eq("user_id", userId)
    .eq("status", "accepted");
  const myCalIds = (memberRows ?? []).map((r: { calendar_id: string }) => r.calendar_id);

  // 3) Termine aus meinen Kalendern
  //    – ohne Rollen:   gelten allen Mitgliedern (auch mir)
  //    – mit Rollen:    nur wenn mir eine Rolle zugewiesen ist
  const past = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
  const future = new Date(Date.now() + 400 * 86400000).toISOString().split("T")[0];

  const picked = new Map<string, Ev>();

  if (myCalIds.length) {
    const { data: evs } = await supa
      .from("events")
      .select("*, event_roles(*), calendars(name)")
      .in("calendar_id", myCalIds)
      .gte("date", past)
      .lte("date", future);
    for (const e of (evs ?? []) as Ev[]) {
      const roles = e.event_roles ?? [];
      if (roles.length === 0 || roles.some((r) => r.assigned_user_id === userId)) {
        picked.set(e.id, e);
      }
    }
  }

  // 4) Direkt an mich geteilte Einzeltermine
  const { data: byUser } = await supa
    .from("event_shares")
    .select("events(*, event_roles(*), calendars(name))")
    .eq("target_user_id", userId);
  for (const row of (byUser ?? []) as { events: Ev | null }[]) {
    if (row.events) picked.set(row.events.id, row.events);
  }

  // 5) An einen meiner Kalender weitergeteilte Einzeltermine
  if (myCalIds.length) {
    const { data: byCal } = await supa
      .from("event_shares")
      .select("events(*, event_roles(*), calendars(name))")
      .in("target_calendar_id", myCalIds);
    for (const row of (byCal ?? []) as { events: Ev | null }[]) {
      if (row.events) picked.set(row.events.id, row.events);
    }
  }

  // 6) ICS bauen
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const raw: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Team-Kalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Team-Kalender (meine Termine)",
    "X-WR-TIMEZONE:Europe/Berlin",
  ];

  for (const ev of picked.values()) {
    raw.push("BEGIN:VEVENT");
    raw.push(`UID:${ev.id}@team-kalender`);
    raw.push(`DTSTAMP:${stamp}`);
    if (ev.time) {
      raw.push(`DTSTART:${fmtDateTime(ev.date, ev.time)}`);
      const endDate = ev.date_end || ev.date;
      const endTime = ev.time_end || ev.time;
      raw.push(`DTEND:${fmtDateTime(endDate, endTime)}`);
    } else {
      raw.push(`DTSTART;VALUE=DATE:${fmtDate(ev.date)}`);
      if (ev.date_end) raw.push(`DTEND;VALUE=DATE:${fmtDate(ev.date_end)}`);
    }
    raw.push(`SUMMARY:${ICS_ESC(ev.title)}`);
    if (ev.description) raw.push(`DESCRIPTION:${ICS_ESC(ev.description)}`);
    if (ev.location)    raw.push(`LOCATION:${ICS_ESC(ev.location)}`);
    if (ev.calendars?.name) raw.push(`CATEGORIES:${ICS_ESC(ev.calendars.name)}`);
    raw.push("END:VEVENT");
  }
  raw.push("END:VCALENDAR");

  const body = raw.map(fold).join("\r\n");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
});
