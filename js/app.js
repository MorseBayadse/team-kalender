// ============================================================
// APP.JS – Team Kalender App (Supabase Edition)
// ============================================================

import * as DB from './db.js';

// ── Globaler App-Zustand ─────────────────────────────────────
let currentUser = null;
let allProfiles = [];   // gecachte Profile für Mitglieder-Anzeige

const CAL_COLORS = ['#5B5FEF','#FF6B6B','#43D9AD','#FFB547','#8B8FF8','#06B6D4','#F59E0B','#EC4899','#10B981','#6366F1'];
let selectedColor = CAL_COLORS[0], selectedVisibility = 'team', eventSelectedColor = CAL_COLORS[0];
let activeCalendarId = null, activeCalendarData = null;
// Multi-Kalender-Unterstützung
let allCalendars       = [];        // alle akzeptierten Kalender {id,name,color}
let loadedCalendars    = new Map(); // id -> getCalendarDetails-Daten (Cache)
let activeCalendarIds  = new Set(); // aktuell in der Ansicht sichtbare Kalender
let viewYear = new Date().getFullYear(), viewMonth = new Date().getMonth();
let viewWeek = null, selectedDay = null, calView = 'month', editingEventId = null;
let currentRoles = [];
let settingsCalId = null;

// ── Hilfsfunktionen ──────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toDateStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dayAddDays = (s, n) => { const d = new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return toDateStr(d); };
const weekAddDays = (s, n) => dayAddDays(s, n);
const getMondayOf = d => { const r=new Date(d+'T00:00:00'); const day=r.getDay(); r.setDate(r.getDate()-(day===0?6:day-1)); return toDateStr(r); };
// ISO 8601 Kalenderwoche
function isoWeek(dateLike) {
  const d = (dateLike instanceof Date) ? new Date(dateLike) : new Date(dateLike + 'T00:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
}

// ── Feiertage Rheinland-Pfalz ───────────────────────────────
// Gauß'sche Osterformel
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31);
  const da = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(year, mo - 1, da);
}
const _holidayCache = new Map();
function getRLPHolidays(year) {
  if (_holidayCache.has(year)) return _holidayCache.get(year);
  const easter = easterSunday(year);
  const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return toDateStr(x); };
  const set = new Set([
    `${year}-01-01`,          // Neujahr
    addD(easter, -2),          // Karfreitag
    addD(easter, 1),           // Ostermontag
    `${year}-05-01`,          // Tag der Arbeit
    addD(easter, 39),          // Christi Himmelfahrt
    addD(easter, 50),          // Pfingstmontag
    addD(easter, 60),          // Fronleichnam (RLP)
    `${year}-10-03`,          // Tag der Deutschen Einheit
    `${year}-11-01`,          // Allerheiligen (RLP)
    `${year}-12-25`,          // 1. Weihnachtstag
    `${year}-12-26`,          // 2. Weihnachtstag
  ]);
  _holidayCache.set(year, set);
  return set;
}
function isHoliday(ds) {
  if (!ds || typeof ds !== 'string') return false;
  const y = parseInt(ds.slice(0, 4), 10);
  return getRLPHolidays(y).has(ds);
}
// Sonntag oder Feiertag? ds = 'YYYY-MM-DD'
function isSunOrHol(ds) {
  if (!ds) return false;
  const d = new Date(ds + 'T00:00:00');
  return d.getDay() === 0 || isHoliday(ds);
}

// Rollen-Status eines Termins: 'none' (keine Rollen), 'full' (alle besetzt), 'open' (mindestens eine offen)
function getRoleStatus(ev) {
  const roles = ev?.event_roles || [];
  if (!roles.length) return 'none';
  return roles.every(r => r.assigned_user_id) ? 'full' : 'open';
}
// HTML für die Kontrollleuchte. Liefert '' wenn der Termin keine Rollen hat.
function roleLightHTML(ev, variant = '') {
  const s = getRoleStatus(ev);
  if (s === 'none') return '';
  const title = s === 'full' ? 'Alle Rollen besetzt' : 'Noch nicht alle Rollen besetzt';
  return `<span class="ev-status-dot ${s}${variant?' '+variant:''}" title="${title}"></span>`;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}
function showMsg(text, type = 'error') {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = 'auth-msg ' + type;
}
function clearMsg() {
  const el = document.getElementById('authMsg');
  el.className = 'auth-msg';
  el.textContent = '';
}
function showToast(msg, type = 'success') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1A1D2E;color:#fff;padding:12px 22px;border-radius:50px;font-size:14px;font-weight:600;z-index:9999;transition:opacity .3s'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#FF6B6B' : '#43D9AD';
  t.style.color = '#fff';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.opacity = '0', 2800);
}

// ── Auth-Tabs ────────────────────────────────────────────────
window.switchTab = tab => {
  document.querySelectorAll('.auth-tab').forEach((b, i) => b.classList.toggle('active', (i===0)===(tab==='login')));
  document.getElementById('form-login').classList.toggle('active', tab==='login');
  document.getElementById('form-register').classList.toggle('active', tab==='register');
  clearMsg();
};

// ── Registrierung ────────────────────────────────────────────
window.handleRegister = async e => {
  e.preventDefault();
  clearMsg();
  const fn    = document.getElementById('reg-firstname').value.trim();
  const ln    = document.getElementById('reg-lastname').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const pw    = document.getElementById('reg-password').value;
  const pw2   = document.getElementById('reg-password2').value;

  // Validierung
  if (!fn || !ln)    return showMsg('Bitte Vor- und Nachname eingeben.');
  if (pw !== pw2)    return showMsg('Die Passwörter stimmen nicht überein.');
  if (pw.length < 6) return showMsg('Das Passwort muss mindestens 6 Zeichen lang sein.');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Wird registriert…';

  try {
    const user = await DB.signUp(fn, ln, email, pw);
    showMsg('✅ Konto erstellt! Du wirst angemeldet…', 'success');
    e.target.reset();
    // Direkt einloggen nach Registrierung
    setTimeout(async () => {
      try { await DB.signIn(email, pw); } catch { switchTab('login'); }
    }, 800);
  } catch (err) {
    const msg = err.message ?? '';
    if (msg.includes('already registered') || msg.includes('already been registered')) {
      showMsg('❌ Diese E-Mail ist bereits registriert. Bitte anmelden.');
    } else if (msg.includes('invalid') && msg.includes('email')) {
      showMsg('❌ Bitte eine gültige E-Mail-Adresse eingeben.');
    } else if (msg.includes('Password') || msg.includes('password')) {
      showMsg('❌ Passwort zu schwach. Bitte mindestens 6 Zeichen verwenden.');
    } else {
      showMsg('❌ Fehler bei der Registrierung: ' + msg);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Konto erstellen →';
  }
};

// ── Anmeldung ────────────────────────────────────────────────
window.handleLogin = async e => {
  e.preventDefault();
  clearMsg();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pw    = document.getElementById('login-password').value;

  if (!email) return showMsg('❌ Bitte E-Mail-Adresse eingeben.');
  if (!pw)    return showMsg('❌ Bitte Passwort eingeben.');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Wird angemeldet…';

  try {
    await DB.signIn(email, pw);
    // enterApp wird via onAuthChange aufgerufen
  } catch (err) {
    const msg = err.message ?? '';
    if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
      // Unterscheide: E-Mail nicht registriert vs. falsches Passwort
      // Dummy-Login mit falsem Passwort um zu prüfen ob E-Mail existiert
      const { error: checkErr } = await DB.supabase.auth.signInWithPassword({ email, password: '__CHECK__' });
      if (checkErr?.message?.includes('Invalid login credentials')) {
        // Gleicher Fehler = E-Mail existiert, Passwort falsch
        showMsg('❌ Falsches Passwort. Bitte überprüfe dein Passwort.');
      } else {
        // Anderer Fehler = E-Mail nicht registriert
        showMsg('❌ Diese E-Mail-Adresse ist nicht registriert. Bitte zuerst registrieren.');
      }
    } else if (msg.includes('Email not confirmed')) {
      showMsg('❌ E-Mail noch nicht bestätigt. Bitte Postfach prüfen.');
    } else if (msg.includes('too many') || msg.includes('rate limit')) {
      showMsg('❌ Zu viele Versuche. Bitte kurz warten.');
    } else {
      showMsg('❌ Anmeldung fehlgeschlagen: ' + msg);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Anmelden →';
  }
};

// ── App betreten ─────────────────────────────────────────────
async function enterApp(user) {
  currentUser = user;
  // Privaten Kalender sicherstellen (Backfill für Altnutzer)
  try { await DB.ensurePersonalCalendar(user.id); } catch (_) {}
  // Profile für Mitglieder-Anzeige vorladen
  allProfiles = await DB.getProfiles().catch(() => []);

  document.getElementById('navAvatar').textContent = user.avatar ?? '??';
  document.getElementById('dropdownName').textContent = `${user.firstname} ${user.lastname}`;
  document.getElementById('dropdownEmail').textContent = user.email;

  showScreen('home');
  await Promise.all([renderInvites(), renderCalendars(), renderMyEvents()]);
}

// ── ICS-Abo (Outlook/Apple Kalender) ─────────────────────────
window.openIcsDialog = async () => {
  closeDropdown();
  const modal = document.getElementById('icsModal');
  const urlInp = document.getElementById('ics-url');
  urlInp.value = 'Lädt...';
  modal.classList.add('open');
  try {
    let sub = await DB.getIcsSubscription(currentUser.id);
    if (!sub) sub = await DB.createIcsSubscription(currentUser.id);
    urlInp.value = sub.url || DB.icsUrl(sub.token);
  } catch (err) {
    urlInp.value = '';
    showToast('Fehler: ' + err.message, 'error');
  }
};
window.closeIcsDialog = () => {
  document.getElementById('icsModal').classList.remove('open');
};
window.copyIcsUrl = async () => {
  const inp = document.getElementById('ics-url');
  try {
    await navigator.clipboard.writeText(inp.value);
    showToast('URL kopiert.');
  } catch (_) {
    inp.select(); document.execCommand('copy');
    showToast('URL kopiert.');
  }
};
window.regenIcsUrl = async () => {
  if (!confirm('Alten Link ungültig machen und einen neuen erzeugen?')) return;
  try {
    const sub = await DB.createIcsSubscription(currentUser.id);
    document.getElementById('ics-url').value = sub.url;
    showToast('Neuer Link erzeugt.');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

// ── Abmeldung ────────────────────────────────────────────────
window.handleLogout = async () => {
  try {
    await DB.signOut();
    currentUser = null;
    activeCalendarId = null;
    activeCalendarData = null;
    closeDropdown();
    showScreen('auth');
    clearMsg();
  } catch (err) {
    showToast('Fehler beim Abmelden.', 'error');
  }
};

// ── Dropdown ─────────────────────────────────────────────────
window.toggleDropdown = () => document.getElementById('avatarDropdown').classList.toggle('open');
window.closeDropdown  = () => document.getElementById('avatarDropdown').classList.remove('open');
document.addEventListener('click', e => {
  const btn = document.getElementById('avatarBtn');
  if (btn && !btn.contains(e.target)) closeDropdown();
});

// ── Farbpicker ───────────────────────────────────────────────
function buildColorPicker(containerId, currentColor, onSelect) {
  const p = document.getElementById(containerId);
  p.innerHTML = CAL_COLORS.map((c) =>
    `<div class="color-dot ${c===currentColor?'selected':''}" style="background:${c}" onclick="(${onSelect.toString()})('${c}',this)"></div>`
  ).join('');
}

function buildCalColorPicker() {
  const p = document.getElementById('colorPicker');
  p.innerHTML = CAL_COLORS.map((c, i) =>
    `<div class="color-dot ${i===0?'selected':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`
  ).join('');
  selectedColor = CAL_COLORS[0];
}

window.selectColor = (color, el) => {
  selectedColor = color;
  document.querySelectorAll('#colorPicker .color-dot').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
};
window.selectEventColor = (color, el) => {
  eventSelectedColor = color;
  document.querySelectorAll('#eventColorPicker .color-dot').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
};
window.selectVis = vis => {
  selectedVisibility = vis;
  ['private','team','public'].forEach(v => document.getElementById('vis-'+v).classList.toggle('active', v===vis));
  const hints = { private:'Nur du kannst diesen Kalender sehen.', team:'Nur eingeladene Mitglieder können diesen Kalender sehen.', public:'Alle registrierten Nutzer können diesen Kalender entdecken.' };
  document.getElementById('visHint').textContent = hints[vis];
};

// ── Kalender erstellen ───────────────────────────────────────
window.openCreateModal = () => {
  buildCalColorPicker();
  document.getElementById('cal-name').value = '';
  document.getElementById('cal-desc').value = '';
  selectVis('team');
  document.getElementById('createModal').classList.add('open');
  setTimeout(() => document.getElementById('cal-name').focus(), 100);
};
window.closeCreateModal = () => document.getElementById('createModal').classList.remove('open');

window.createCalendar = async () => {
  const name = document.getElementById('cal-name').value.trim();
  if (!name) return;
  try {
    await DB.createCalendar(currentUser.id, {
      name,
      description: document.getElementById('cal-desc').value.trim(),
      color: selectedColor,
      visibility: selectedVisibility,
    });
    closeCreateModal();
    await renderCalendars();
    showToast('Kalender erstellt!');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

// ── Home: Kalender rendern ───────────────────────────────────
async function renderCalendars() {
  const grid  = document.getElementById('calendarGrid');
  const label = document.getElementById('calCountLabel');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Lädt...</div>';
  try {
    const cals = await DB.getCalendars(currentUser.id);
    const myCals = cals.filter(c => c.myStatus === 'accepted');
    label.textContent = myCals.length === 0 ? 'Noch keine Kalender' : myCals.length + ' Kalender';

    if (myCals.length === 0) {
      grid.innerHTML = '<div class="empty-cals"><div style="font-size:44px;margin-bottom:14px">📅</div><h3>Noch keine Kalender</h3><p>Klicke auf „Neuer Kalender" um zu starten.</p></div>';
      return;
    }

    grid.innerHTML = myCals.map(cal => {
      const roleLabel = { owner:'Ersteller', admin:'Admin', member:'Mitglied' }[cal.myRole] ?? 'Mitglied';
      const roleCls   = { owner:'role-owner', admin:'role-admin', member:'role-member' }[cal.myRole] ?? 'role-member';
      return `<div class="cal-card" onclick="openCalendar('${cal.id}')">
        <div class="cal-card-stripe" style="background:${cal.color}"></div>
        <div class="cal-card-body">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">
            <div class="cal-card-name">${esc(cal.name)}</div>
            <span class="role-badge ${roleCls}">${roleLabel}</span>
          </div>
          <div class="cal-card-desc">${cal.description ? esc(cal.description) : 'Keine Beschreibung'}</div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--accent)">Fehler beim Laden: ' + esc(err.message) + '</div>';
  }
}

// ── Home: Einladungen rendern ────────────────────────────────
async function renderInvites() {
  try {
    const cals    = await DB.getCalendars(currentUser.id);
    const pending = cals.filter(c => c.myStatus === 'pending');
    const sec     = document.getElementById('invitesSection');
    sec.style.display = pending.length > 0 ? 'block' : 'none';
    document.getElementById('invitesList').innerHTML = pending.map(cal =>
      `<div class="invite-card">
        <div style="font-size:24px">📅</div>
        <div style="flex:1">
          <div style="font-weight:700">${esc(cal.name)}</div>
          <div style="font-size:12px;color:var(--text-muted)">Einladung ausstehend</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-accept" onclick="acceptInvite('${cal.id}')">✓</button>
          <button class="btn-decline" onclick="declineInvite('${cal.id}')">✕</button>
        </div>
      </div>`
    ).join('');
  } catch (_) {}
}

window.acceptInvite = async calId => {
  try {
    await DB.acceptInvite(calId, currentUser.id);
    await Promise.all([renderInvites(), renderCalendars()]);
    showToast('Einladung angenommen!');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};
window.declineInvite = async calId => {
  try {
    await DB.removeMember(calId, currentUser.id);
    await Promise.all([renderInvites(), renderCalendars()]);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

// ── Home: Meine Termine ──────────────────────────────────────
async function renderMyEvents() {
  const list  = document.getElementById('myEventsList');
  const label = document.getElementById('myEventsLabel');
  try {
    const evs = await DB.getMyEvents(currentUser.id);
    label.textContent = evs.length === 0 ? 'Keine bevorstehenden Termine' : evs.length + ' bevorstehende';
    list.innerHTML = evs.map(ev => {
      const d = new Date(ev.date + 'T00:00:00');
      return `<div class="my-event-row" style="border-left-color:${ev.calColor}" onclick="jumpToEvent('${ev.calendar_id}','${ev.date}')">
        <div class="my-event-date-badge">
          <div class="day">${d.getDate()}</div>
          <div class="mon">${d.toLocaleDateString('de-DE',{month:'short'})}</div>
        </div>
        <div style="flex:1">
          <div class="my-event-title">${roleLightHTML(ev,'lg')}${esc(ev.title)}</div>
          <div class="my-event-meta">${esc(ev.calName)}${ev.time ? ' · ' + ev.time : ''}</div>
        </div>
        <span class="role-badge role-member">🎭 ${esc(ev.myRoleName)}</span>
      </div>`;
    }).join('');
  } catch (_) {}
}
window.jumpToEvent = (calId, date) => {
  openCalendar(calId).then(() => {
    const d = new Date(date + 'T00:00:00');
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    selectedDay = date;
    renderMonth();
    renderDayPanel(date);
  });
};

// ── Kalender öffnen ──────────────────────────────────────────
window.openCalendar = async id => {
  try {
    // Alle Kalender des Users laden (für die Auswahlleiste) – eigene + geteilte
    const cals = await DB.getCalendars(currentUser.id);
    allCalendars = cals
      .filter(c => c.myStatus === 'accepted')
      .map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        isShared: !!c.isShared,
        readOnly: !!c.readOnly,
      }));

    // Den angeklickten Kalender laden + cachen
    const data = await DB.getCalendarDetails(id);
    loadedCalendars.set(id, data);
    activeCalendarData = data;
    activeCalendarId   = id;
    activeCalendarIds  = new Set([id]);

    viewYear  = new Date().getFullYear();
    viewMonth = new Date().getMonth();
    selectedDay = null;
    updateCalNavTitle();
    updateNavbarWriteState();
    showScreen('calendar');
    renderCalendarStrip();
    setCalView('month');
  } catch (err) {
    showToast('Kalender konnte nicht geladen werden: ' + err.message, 'error');
  }
};
window.goHome = async () => {
  activeCalendarId = null;
  activeCalendarData = null;
  activeCalendarIds = new Set();
  loadedCalendars.clear();
  selectedDay = null;
  showScreen('home');
  await Promise.all([renderInvites(), renderCalendars(), renderMyEvents()]);
};

// Prüft ob der "primäre" Kalender (der Schreib-Ziel-Kalender) read-only ist
function primaryCalendarIsReadOnly() {
  const cal = allCalendars.find(c => c.id === activeCalendarId);
  return !!cal?.readOnly;
}
// "+ Termin"-Button und Einstellungen-Button bei read-only ausgrauen
function updateNavbarWriteState() {
  const ro = primaryCalendarIsReadOnly();
  const addBtn = document.querySelector('#screen-calendar .navbar-right .btn-primary');
  if (addBtn) {
    addBtn.disabled = ro;
    addBtn.style.opacity = ro ? '.45' : '';
    addBtn.style.cursor  = ro ? 'not-allowed' : '';
    addBtn.title = ro ? 'Dieser Kalender ist nur lesbar (geteilt)' : '';
  }
  const gear = document.querySelector('#screen-calendar .navbar-right .nav-icon-btn');
  if (gear) {
    gear.disabled = ro;
    gear.style.opacity = ro ? '.45' : '';
    gear.style.cursor  = ro ? 'not-allowed' : '';
  }
}

// Titel/Farbe in der Navbar aktualisieren
function updateCalNavTitle() {
  const titleEl = document.getElementById('calNavTitle');
  const dotEl   = document.getElementById('calNavDot');
  if (!titleEl || !dotEl) return;
  const n = activeCalendarIds.size;
  if (n === 0) {
    titleEl.textContent = '';
    dotEl.style.background = '#ccc';
  } else if (n === 1) {
    const cal = allCalendars.find(c => activeCalendarIds.has(c.id)) || activeCalendarData;
    titleEl.textContent = cal?.name ?? '';
    dotEl.style.background = cal?.color ?? '#5B5FEF';
    dotEl.style.backgroundImage = '';
  } else if (n === allCalendars.length) {
    titleEl.textContent = 'Alle Kalender';
    dotEl.style.background = 'conic-gradient(#5B5FEF,#43D9AD,#FFB547,#FF6B6B,#5B5FEF)';
  } else {
    titleEl.textContent = `${n} Kalender`;
    dotEl.style.background = 'conic-gradient(#5B5FEF,#8B8FF8,#43D9AD,#5B5FEF)';
  }
}

// Die Auswahlleiste mit allen Kalender-Chips rendern
function renderCalendarStrip() {
  const strip = document.getElementById('calendarStrip');
  if (!strip) return;
  if (!allCalendars.length) { strip.innerHTML = ''; return; }

  const allActive = activeCalendarIds.size === allCalendars.length;
  const allChip = `<button class="cal-chip cal-chip-all${allActive?' active':''}" onclick="toggleAllCalendars()" title="Alle Kalender anzeigen">📅 Alle Kalender</button>`;
  const sep = `<div class="cal-chip-sep"></div>`;
  const chips = allCalendars.map(c => {
    const isActive = activeCalendarIds.has(c.id);
    const roClass  = c.readOnly ? ' cal-chip-ro' : '';
    const roIcon   = c.readOnly ? '<span class="cal-chip-ro-icon" title="Nur lesbar (geteilter Kalender)">👁</span>' : '';
    const titleTxt = esc(c.name) + (c.readOnly ? ' · nur lesbar (geteilt)' : '') + (isActive ? ' · aktiv' : '');
    return `<button class="cal-chip${isActive?' active':''}${roClass}" onclick="toggleCalendar('${c.id}')" title="${titleTxt}">
      <span class="cal-chip-dot" style="background:${c.color}"></span>${roIcon}${esc(c.name)}
    </button>`;
  }).join('');
  strip.innerHTML = allChip + sep + chips;
}

// Einen Kalender ein-/ausschalten (Multi-Select)
window.toggleCalendar = async id => {
  if (activeCalendarIds.has(id)) {
    // Letzten Kalender nicht abschalten — sonst wäre nichts mehr zu sehen
    if (activeCalendarIds.size === 1) return;
    activeCalendarIds.delete(id);
  } else {
    // Ggf. nachladen
    if (!loadedCalendars.has(id)) {
      try {
        const data = await DB.getCalendarDetails(id);
        loadedCalendars.set(id, data);
      } catch (err) {
        showToast('Fehler: ' + err.message, 'error');
        return;
      }
    }
    activeCalendarIds.add(id);
  }
  // activeCalendarId = "primärer" Kalender (erster aktiver) — für Settings/Farbe
  const firstId = activeCalendarIds.values().next().value;
  activeCalendarId   = firstId;
  activeCalendarData = loadedCalendars.get(firstId);
  updateCalNavTitle();
  updateNavbarWriteState();
  renderCalendarStrip();
  renderCurrentView();
};

// "Alle Kalender"-Toggle
window.toggleAllCalendars = async () => {
  const allActive = activeCalendarIds.size === allCalendars.length;
  if (allActive) {
    // Zurück auf nur den primären
    const keep = activeCalendarId || allCalendars[0]?.id;
    activeCalendarIds = new Set(keep ? [keep] : []);
  } else {
    // Alle laden und aktivieren
    try {
      await Promise.all(allCalendars.map(async c => {
        if (!loadedCalendars.has(c.id)) {
          loadedCalendars.set(c.id, await DB.getCalendarDetails(c.id));
        }
      }));
    } catch (err) {
      showToast('Fehler beim Laden: ' + err.message, 'error');
      return;
    }
    activeCalendarIds = new Set(allCalendars.map(c => c.id));
  }
  const firstId = activeCalendarIds.values().next().value;
  activeCalendarId   = firstId;
  activeCalendarData = loadedCalendars.get(firstId);
  updateCalNavTitle();
  updateNavbarWriteState();
  renderCalendarStrip();
  renderCurrentView();
};

// ── Ansicht wechseln ─────────────────────────────────────────
const VIEW_IDS = { year:'viewYear', month:'viewMonth', week:'viewWeek', day:'viewDay', mine:'viewMine' };
window.setCalView = v => {
  calView = v;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  Object.entries(VIEW_IDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = key === v ? 'flex' : 'none';
  });
  const wdh = document.querySelector('.weekdays-header');
  if (wdh) wdh.style.display = v === 'month' ? 'grid' : 'none';
  renderCurrentView();
};
function renderCurrentView() {
  if (calView === 'month')      renderMonth();
  else if (calView === 'year')  renderYearView();
  else if (calView === 'week')  renderWeekView();
  else if (calView === 'day')   renderDayView();
  else if (calView === 'mine')  renderMineView();
}
window.calNavPrev = () => {
  if (calView === 'year')      { viewYear--; renderCurrentView(); }
  else if (calView === 'week') { viewWeek = weekAddDays(viewWeek, -7); renderCurrentView(); }
  else if (calView === 'day')  { selectedDay = dayAddDays(selectedDay || toDateStr(new Date()), -1); renderCurrentView(); }
  else changeMonth(-1);
};
window.calNavNext = () => {
  if (calView === 'year')      { viewYear++; renderCurrentView(); }
  else if (calView === 'week') { viewWeek = weekAddDays(viewWeek, 7); renderCurrentView(); }
  else if (calView === 'day')  { selectedDay = dayAddDays(selectedDay || toDateStr(new Date()), 1); renderCurrentView(); }
  else changeMonth(1);
};
function changeMonth(dir) {
  viewMonth += dir;
  if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
  if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
  renderMonth();
}
window.goToday = () => {
  viewYear  = new Date().getFullYear();
  viewMonth = new Date().getMonth();
  selectedDay = toDateStr(new Date());
  renderCurrentView();
};

// ── Monatsansicht ────────────────────────────────────────────
// Termine über alle aktiven Kalender hinweg sammeln und nach Datum/Zeit sortieren.
// Jeder Termin wird mit der Farbe seines Kalenders ausgestattet, falls keine
// eigene Farbe gesetzt ist. So bleiben Termine aus verschiedenen Kalendern
// in allen Ansichten farblich unterscheidbar.
function getEvents() {
  if (!activeCalendarIds.size) return activeCalendarData?.events ?? [];
  const merged = [];
  for (const id of activeCalendarIds) {
    const cal = loadedCalendars.get(id);
    if (!cal) continue;
    const calColor = cal.color || '#5B5FEF';
    for (const ev of (cal.events || [])) {
      merged.push({ ...ev, color: ev.color || calColor, __calId: id, __calName: cal.name, __calColor: calColor });
    }
  }
  merged.sort((a,b) => (a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
  return merged;
}

function renderMonth() {
  const label = document.getElementById('monthLabelText');
  label.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay  = new Date(viewYear, viewMonth + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Mo=0
  const today    = toDateStr(new Date());
  const todayKW  = isoWeek(new Date());
  const events   = getEvents();

  const grid = document.getElementById('calGrid');
  grid.classList.add('with-kw');

  let html = '';
  let day = 1 - startDow;
  for (let row = 0; row < 6; row++) {
    // Montag dieser Zeile bestimmen → KW ableiten
    const mondayDate = new Date(viewYear, viewMonth, day);
    const kw = isoWeek(mondayDate);
    const kwCls = (kw === todayKW && mondayDate.getFullYear() === new Date().getFullYear()) ? 'kw-cell today-kw' : 'kw-cell';
    html += `<div class="${kwCls}"><span class="kw-prefix">KW</span><span class="kw-num">${kw}</span></div>`;
    for (let col = 0; col < 7; col++) {
      const d    = new Date(viewYear, viewMonth, day);
      const ds   = toDateStr(d);
      const otherMonth = d.getMonth() !== viewMonth;
      const dayEvs = events.filter(e => e.date === ds || (e.date <= ds && e.date_end >= ds));
      const cls = ['cal-day', otherMonth?'other-month':'', ds===today?'today':'', ds===selectedDay?'selected':'', isSunOrHol(ds)?'is-sun-hol':''].filter(Boolean).join(' ');
      html += `<div class="${cls}" onclick="selectDay('${ds}')">
        <div class="day-num">${d.getDate()}</div>
        ${dayEvs.slice(0,3).map(ev => `<div class="ev-pill" style="background:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="event.stopPropagation();openEventModal('${ev.id}')">${roleLightHTML(ev)}${esc(ev.title)}</div>`).join('')}
        ${dayEvs.length > 3 ? `<div class="ev-more">+${dayEvs.length-3} mehr</div>` : ''}
      </div>`;
      day++;
    }
    if (day > lastDay.getDate() + startDow) break;
  }
  grid.innerHTML = html;
  if (selectedDay) renderDayPanel(selectedDay);
}

window.selectDay = ds => {
  selectedDay = ds;
  renderMonth();
  renderDayPanel(ds);
};
function renderDayPanel(ds) {
  const d       = new Date(ds + 'T00:00:00');
  const dayEvs  = getEvents().filter(e => e.date === ds || (e.date <= ds && e.date_end >= ds));
  const addBtn  = document.getElementById('dayPanelAdd');
  if (addBtn) addBtn.style.display = 'flex';
  document.getElementById('dayPanelTitle').textContent =
    'KW ' + isoWeek(d) + ' · ' + d.toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('dayEvents').innerHTML = dayEvs.length === 0
    ? '<div class="no-events">Keine Termine</div>'
    : dayEvs.map(ev => `<div class="day-event-item" style="border-left-color:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">
        <div class="day-event-time">${ev.time ? ev.time.slice(0,5) : '—'}</div>
        <div style="flex:1">
          <div class="day-event-title">${roleLightHTML(ev,'lg')}${esc(ev.title)}</div>
          ${ev.location ? `<div class="day-event-desc">📍 ${esc(ev.location)}</div>` : ''}
        </div>
      </div>`).join('');
}

// ── Jahresansicht ────────────────────────────────────────────
function renderYearView() {
  document.getElementById('monthLabelText').textContent = viewYear;
  const grid = document.getElementById('yearGrid');
  const events = getEvents();
  const today = toDateStr(new Date());
  // Kurze Wochentags-Labels (Mo, Di, Mi, Do, Fr, Sa, So)
  const WD = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];
  let html = '';
  for (let m = 0; m < 12; m++) {
    const mn   = new Date(viewYear, m, 1).toLocaleDateString('de-DE', { month: 'short' }).replace('.', '');
    const fd   = new Date(viewYear, m, 1);
    const sdow = (fd.getDay() + 6) % 7; // Mo=0
    // KW-Spalte + Wochentage + Tage-Grid getrennt rendern
    let kwCells = '';
    let dayCells = '';
    let day = 1 - sdow;
    for (let row = 0; row < 6; row++) {
      const rowMonday = new Date(viewYear, m, day);
      kwCells += `<div class="mini-kw-num">${isoWeek(rowMonday)}</div>`;
      for (let col = 0; col < 7; col++) {
        const d    = new Date(viewYear, m, day);
        const ds   = toDateStr(d);
        const valid = d.getMonth() === m;
        const evs  = valid ? events.filter(e => e.date === ds || (e.date_end && e.date <= ds && e.date_end >= ds)) : [];
        const isToday = ds === today && valid;
        const sunHol  = valid && isSunOrHol(ds);
        const cls = ['mini-day', isToday?'today-mini':'', sunHol?'is-sun-hol':'', !valid?'mini-day-empty':''].filter(Boolean).join(' ');
        const handler = valid ? `onclick="selectDayYear('${ds}')"` : '';
        const hasEv = evs.length > 0;
        const rs = hasEv ? getRoleStatus(evs[0]) : 'none';
        const dotColor = rs === 'full' ? '#22C55E' : rs === 'open' ? '#EF4444' : (evs[0]?.color || activeCalendarData?.color || '#5B5FEF');
        const dot = hasEv ? `<div class="mini-day-dot" style="background:${dotColor}"></div>` : '';
        dayCells += `<div class="${cls}" ${handler}><span class="mini-day-num">${valid?d.getDate():''}</span>${dot}</div>`;
        day++;
      }
      // Abbruch, wenn Monat fertig und keine weiteren Tage mehr kommen
      if (day > 31 && new Date(viewYear, m, day).getMonth() !== m) break;
    }
    const wdHeader = WD.map((l, i) => `<div class="mini-wd${i===6?' mini-wd-sun':''}">${l}</div>`).join('');
    html += `<div class="mini-month">
      <div class="mini-month-title" onclick="setCalViewFromYear(${m})">${mn}</div>
      <div class="mini-month-body">
        <div class="mini-kw-col"><div class="mini-kw-head">KW</div>${kwCells}</div>
        <div class="mini-month-right">
          <div class="mini-wd-row">${wdHeader}</div>
          <div class="mini-day-grid">${dayCells}</div>
        </div>
      </div>
    </div>`;
  }
  grid.innerHTML = html;
}
window.setCalViewFromYear = m => {
  viewMonth = m;
  setCalView('month');
};
window.selectDayYear = ds => {
  const d = new Date(ds + 'T00:00:00');
  viewMonth = d.getMonth();
  selectedDay = ds;
  setCalView('month');
};

// ── Wochenansicht ────────────────────────────────────────────
const CAL_START_HOUR = 6;   // Tag beginnt um 06:00
const CAL_END_HOUR   = 24;  // Tag endet um 19:00 (untere Kante)
function renderWeekView() {
  if (!viewWeek) viewWeek = getMondayOf(toDateStr(new Date()));
  const today  = toDateStr(new Date());
  const events = getEvents();
  const HOURS  = CAL_END_HOUR - CAL_START_HOUR; // 13 Slots (06..18)
  const H      = 48;
  const days   = Array.from({length:7}, (_,i) => dayAddDays(viewWeek, i));
  const start  = new Date(days[0]+'T00:00:00');
  const end    = new Date(days[6]+'T00:00:00');
  document.getElementById('monthLabelText').textContent =
    'KW ' + isoWeek(start) + ' · ' +
    start.toLocaleDateString('de-DE',{day:'numeric',month:'short'}) + ' – ' +
    end.toLocaleDateString('de-DE',{day:'numeric',month:'short',year:'numeric'});

  document.getElementById('weekDayHeaders').innerHTML = days.map(ds => {
    const d   = new Date(ds+'T00:00:00');
    const cls = ['week-day-header', ds===today?'today-col':'', isSunOrHol(ds)?'is-sun-hol':''].filter(Boolean).join(' ');
    return `<div class="${cls}">
      <div class="wdh-dow">${d.toLocaleDateString('de-DE',{weekday:'short'})}</div>
      <div class="wdh-num">${d.getDate()}</div>
    </div>`;
  }).join('');

  let timecol = '';
  for (let h = 0; h < HOURS; h++) {
    timecol += `<div class="week-time-slot">${String(CAL_START_HOUR+h).padStart(2,'0')}:00</div>`;
  }
  timecol += `<div class="week-time-slot week-time-slot-end">${String(CAL_END_HOUR).padStart(2,'0')}:00</div>`;
  document.getElementById('weekTimeCol').innerHTML = timecol;

  // Helfer: kompakte Mini-Pille für Früh/Spät-Zeile
  const miniPill = ev => {
    const bg = ev.color||activeCalendarData?.color||'#5B5FEF';
    const t  = (ev.time||'').slice(0,5);
    return `<div class="week-mini-pill" style="background:${bg}" onclick="openEventModal('${ev.id}')" title="${esc(ev.title)} ${t}">${roleLightHTML(ev)}<span class="wmp-t">${t}</span> ${esc(ev.title)}</div>`;
  };

  // Früh- und Spät-Zeilen (fixiert) + Haupt-Grid
  const earlyRow = document.getElementById('weekEarlyDays');
  const lateRow  = document.getElementById('weekLateDays');
  if (earlyRow) earlyRow.style.gridTemplateColumns = `repeat(7,1fr)`;
  if (lateRow)  lateRow.style.gridTemplateColumns  = `repeat(7,1fr)`;

  let earlyHtml = '', lateHtml = '', anyEarly = false, anyLate = false;
  const mainCols = days.map(ds => {
    const dayEvs = events.filter(e => e.date === ds && e.time);
    const earlyEvs = dayEvs.filter(e => { const h=parseInt((e.time||'0').split(':')[0],10); return h < CAL_START_HOUR; });
    const lateEvs  = dayEvs.filter(e => { const h=parseInt((e.time||'0').split(':')[0],10); return h >= CAL_END_HOUR; });
    const mainEvs  = dayEvs.filter(e => { const h=parseInt((e.time||'0').split(':')[0],10); return h >= CAL_START_HOUR && h < CAL_END_HOUR; });
    if (earlyEvs.length) anyEarly = true;
    if (lateEvs.length)  anyLate  = true;
    const todayCls = ds === today ? ' today-col' : '';
    const sunHolCls = isSunOrHol(ds) ? ' is-sun-hol' : '';
    earlyHtml += `<div class="week-extra-cell${todayCls}${sunHolCls}">${earlyEvs.map(miniPill).join('')}</div>`;
    lateHtml  += `<div class="week-extra-cell${todayCls}${sunHolCls}">${lateEvs.map(miniPill).join('')}</div>`;
    const lines  = Array.from({length:HOURS+1}, (_,h) => `<div class="week-hour-line" style="top:${h*H}px"></div>`).join('');
    const blocks = mainEvs.map(ev => {
      const [hh,mm] = (ev.time||'00:00').split(':').map(Number);
      const top = ((hh-CAL_START_HOUR)*60+mm)/60*H;
      const dur = ev.time_end ? (() => { const [eh,em]=(ev.time_end||'01:00').split(':').map(Number); const d=((eh*60+em)-(hh*60+mm))/60*H; return Math.min(d, (HOURS*H)-top); })() : H;
      return `<div class="week-event-block" style="top:${top}px;height:${Math.max(dur,20)}px;left:4px;right:4px;background:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">${roleLightHTML(ev)}${esc(ev.title)}</div>`;
    }).join('');
    return `<div class="week-day-col${todayCls}${sunHolCls}" style="height:${HOURS*H}px">${lines}${blocks}</div>`;
  }).join('');

  if (earlyRow) earlyRow.innerHTML = earlyHtml;
  if (lateRow)  lateRow.innerHTML  = lateHtml;
  const earlyContainer = document.getElementById('weekEarlyRow');
  const lateContainer  = document.getElementById('weekLateRow');
  if (earlyContainer) earlyContainer.style.display = anyEarly ? 'flex' : 'none';
  if (lateContainer)  lateContainer.style.display  = anyLate  ? 'flex' : 'none';

  document.getElementById('weekDaysGrid').style.gridTemplateColumns = `repeat(7,1fr)`;
  document.getElementById('weekDaysGrid').innerHTML = mainCols;
}

// ── Tagesansicht ─────────────────────────────────────────────
function renderDayView() {
  const ds     = selectedDay || toDateStr(new Date());
  const d      = new Date(ds+'T00:00:00');
  const events = getEvents().filter(e => e.date === ds);
  const HOURS  = CAL_END_HOUR - CAL_START_HOUR; // 13 Slots (06..18)
  const H      = 60;
  document.getElementById('monthLabelText').textContent =
    'KW ' + isoWeek(d) + ' · ' + d.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dayViewHeader').textContent =
    'KW ' + isoWeek(d) + ' · ' + d.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});

  let timecol = '';
  for (let h = 0; h < HOURS; h++) timecol += `<div class="day-view-time-slot">${String(CAL_START_HOUR+h).padStart(2,'0')}:00</div>`;
  timecol += `<div class="day-view-time-slot day-view-time-slot-end">${String(CAL_END_HOUR).padStart(2,'0')}:00</div>`;
  document.getElementById('dayViewTimecol').innerHTML = timecol;

  const col  = document.getElementById('dayViewEventsCol');
  col.style.position = 'relative';
  col.style.height   = HOURS*H + 'px';
  col.classList.toggle('is-sun-hol', isSunOrHol(ds));
  const dayHdrEl = document.getElementById('dayViewHeader');
  if (dayHdrEl) dayHdrEl.classList.toggle('is-sun-hol', isSunOrHol(ds));

  const timed    = events.filter(e => e.time);
  const earlyEvs = timed.filter(e => { const h=parseInt((e.time||'0').split(':')[0],10); return h < CAL_START_HOUR; });
  const lateEvs  = timed.filter(e => { const h=parseInt((e.time||'0').split(':')[0],10); return h >= CAL_END_HOUR; });
  const mainEvs  = timed.filter(e => { const h=parseInt((e.time||'0').split(':')[0],10); return h >= CAL_START_HOUR && h < CAL_END_HOUR; });

  const miniItem = ev => {
    const bg = ev.color||activeCalendarData?.color||'#5B5FEF';
    const t  = (ev.time||'').slice(0,5);
    return `<div class="day-mini-item" style="background:${bg}" onclick="openEventModal('${ev.id}')">${roleLightHTML(ev,'lg')}<span class="dmi-t">${t}</span><span class="dmi-title">${esc(ev.title)}</span></div>`;
  };
  const earlyEl = document.getElementById('dayEarlyItems');
  const lateEl  = document.getElementById('dayLateItems');
  if (earlyEl) earlyEl.innerHTML = earlyEvs.map(miniItem).join('');
  if (lateEl)  lateEl.innerHTML  = lateEvs.map(miniItem).join('');
  const earlyRow = document.getElementById('dayEarlyRow');
  const lateRow  = document.getElementById('dayLateRow');
  if (earlyRow) earlyRow.style.display = earlyEvs.length ? 'flex' : 'none';
  if (lateRow)  lateRow.style.display  = lateEvs.length  ? 'flex' : 'none';

  const blocks = mainEvs.map(ev => {
    const [hh,mm] = (ev.time||'00:00').split(':').map(Number);
    const top = ((hh-CAL_START_HOUR)*60+mm)/60*H;
    const dur = ev.time_end ? (() => { const [eh,em]=(ev.time_end||'01:00').split(':').map(Number); const d=((eh*60+em)-(hh*60+mm))/60*H; return Math.min(d, (HOURS*H)-top); })() : H;
    return `<div class="day-event-timed" style="top:${top}px;height:${Math.max(dur,28)}px;left:8px;right:8px;background:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">
      ${roleLightHTML(ev,'lg')}${esc(ev.title)}${ev.time?' · '+ev.time.slice(0,5):''}
    </div>`;
  }).join('');
  const now  = new Date();
  const nowH = now.getHours();
  let nowLine = '';
  if (ds === toDateStr(now) && nowH >= CAL_START_HOUR && nowH < CAL_END_HOUR) {
    const nowT = ((nowH-CAL_START_HOUR)*60+now.getMinutes())/60*H;
    nowLine = `<div class="day-now-line" style="top:${nowT}px"></div>`;
  }
  col.innerHTML = blocks + nowLine;
}

// ── "Meine Termine"-Ansicht ───────────────────────────────────
function renderMineView() {
  document.getElementById('monthLabelText').textContent = 'Meine Termine';
  const today  = toDateStr(new Date());
  const events = getEvents()
    .filter(e => e.date >= today)
    .sort((a,b) => (a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
  // "Meine"-Ansicht: Termine, in die ich involviert bin
  //   – Termine ohne Rollen gelten allen Mitgliedern (also auch mir)
  //   – Termine mit Rollen nur, wenn mir eine Rolle zugewiesen ist
  const mineEvs = events.filter(e => {
    const roles = e.event_roles || [];
    if (roles.length === 0) return true;
    return roles.some(r => r.assigned_user_id === currentUser?.id);
  });
  document.getElementById('mineViewLabel').textContent =
    mineEvs.length + ' bevorstehende Termine für mich';
  document.getElementById('mineViewList').innerHTML = mineEvs.map(ev => {
    const d = new Date(ev.date+'T00:00:00');
    const roles = ev.event_roles || [];
    const myRole = roles.find(r => r.assigned_user_id === currentUser?.id);
    const badge = myRole
      ? `<span class="role-badge role-member">🎭 ${esc(myRole.name)}</span>`
      : (roles.length === 0
          ? `<span class="role-badge" style="background:#EEF2FF;color:#5B5FEF">👥 Alle</span>`
          : '');
    return `<div class="my-event-row" style="border-left-color:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">
      <div class="my-event-date-badge"><div class="day">${d.getDate()}</div><div class="mon">${d.toLocaleDateString('de-DE',{month:'short'})}</div></div>
      <div style="flex:1"><div class="my-event-title">${roleLightHTML(ev,'lg')}${esc(ev.title)}</div><div class="my-event-meta">${ev.time?ev.time.slice(0,5):''}</div></div>
      ${badge}
    </div>`;
  }).join('') || '<div class="no-events">Keine anstehenden Termine für dich</div>';
}

// ── Termin-Modal ─────────────────────────────────────────────
function buildEventColorPicker(currentColor) {
  const p = document.getElementById('eventColorPicker');
  p.innerHTML = CAL_COLORS.map(c =>
    `<div class="color-dot ${c===currentColor?'selected':''}" style="background:${c}" onclick="selectEventColor('${c}',this)"></div>`
  ).join('');
  eventSelectedColor = currentColor || CAL_COLORS[0];
}

window.openAddEvent = () => {
  if (primaryCalendarIsReadOnly()) {
    showToast('Dieser Kalender ist nur lesbar (geteilt). Wechsle zu einem deiner eigenen Kalender, um Termine anzulegen.', 'error');
    return;
  }
  editingEventId = null;
  document.getElementById('eventModalTitle').textContent = 'Neuer Termin';
  document.getElementById('ev-title').value       = '';
  document.getElementById('ev-date').value        = selectedDay || toDateStr(new Date());
  document.getElementById('ev-date-end').value    = '';
  document.getElementById('ev-time').value        = '';
  document.getElementById('ev-time-end').value    = '';
  document.getElementById('ev-desc').value        = '';
  document.getElementById('ev-location').value    = '';
  document.getElementById('evDeleteBtn').style.display = 'none';
  buildEventColorPicker(activeCalendarData?.color || CAL_COLORS[0]);
  currentRoles = [];
  renderRolesList();
  document.getElementById('evShareSection').style.display = 'none';
  document.getElementById('eventModal').classList.add('open');
  setTimeout(() => document.getElementById('ev-title').focus(), 100);
};

window.openEventModal = id => {
  const ev = getEvents().find(e => e.id === id);
  if (!ev) return;
  // Ist der Termin aus einem nur-lesbaren (geteilten) Kalender?
  const evCal = allCalendars.find(c => c.id === (ev.__calId || ev.calendar_id));
  const readOnly = !!evCal?.readOnly;
  editingEventId = readOnly ? null : id;
  document.getElementById('eventModalTitle').textContent = readOnly ? 'Termin ansehen (nur lesbar)' : 'Termin bearbeiten';
  document.getElementById('ev-title').value       = ev.title;
  document.getElementById('ev-date').value        = ev.date;
  document.getElementById('ev-date-end').value    = ev.date_end || '';
  document.getElementById('ev-time').value        = ev.time || '';
  document.getElementById('ev-time-end').value    = ev.time_end || '';
  document.getElementById('ev-desc').value        = ev.description || '';
  document.getElementById('ev-location').value    = ev.location || '';
  document.getElementById('evDeleteBtn').style.display = readOnly ? 'none' : 'inline-flex';
  buildEventColorPicker(ev.color || activeCalendarData?.color || CAL_COLORS[0]);
  currentRoles = (ev.event_roles || []).map(r => ({ name: r.name, assignedUserId: r.assigned_user_id }));
  renderRolesList();
  // Alle Eingabefelder + Speichern-Button entsprechend sperren
  const modal = document.getElementById('eventModal');
  modal.querySelectorAll('input, textarea').forEach(el => { el.disabled = readOnly; });
  const saveBtn = modal.querySelector('.modal-actions .btn-primary');
  if (saveBtn) { saveBtn.disabled = readOnly; saveBtn.style.opacity = readOnly ? '.4' : ''; saveBtn.style.cursor = readOnly ? 'not-allowed' : ''; }
  // Sharing-Abschnitt nur für eigene (nicht-read-only) Termine des aktuellen Nutzers
  const shareSec = document.getElementById('evShareSection');
  if (shareSec) {
    if (readOnly) {
      shareSec.style.display = 'none';
    } else {
      shareSec.style.display = 'block';
      refreshEventShareUI(id);
    }
  }
  modal.classList.add('open');
};

// Termin-Freigaben UI aufbauen (Liste + Auswahl)
async function refreshEventShareUI(eventId) {
  const list = document.getElementById('evShareList');
  const sel  = document.getElementById('evShareTarget');
  if (!list || !sel) return;
  list.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Lädt...</div>';
  sel.innerHTML = '';
  try {
    const [shares, cals] = await Promise.all([
      DB.getEventSharesOf(eventId),
      DB.getCalendars(currentUser.id),
    ]);
    // Liste aktueller Freigaben
    if (!shares.length) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Noch nicht geteilt</div>';
    } else {
      list.innerHTML = shares.map(s => {
        const label = s.target_user_id
          ? `👤 ${esc((s.profiles?.firstname ?? '') + ' ' + (s.profiles?.lastname ?? ''))} (privater Kalender)`
          : `📅 ${esc(s.calendars?.name ?? 'Kalender')}`;
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg);border-radius:8px;font-size:13px">
          <span style="flex:1">${label}</span>
          <button type="button" class="btn-danger" style="padding:4px 10px;font-size:11px" onclick="removeEventShare('${s.id}','${eventId}')">✕</button>
        </div>`;
      }).join('');
    }
    // Auswahl: Team-Kalender (akzeptierte, nicht readOnly, nicht privat, nicht der Quell-Kalender)
    // + Nutzer (alle anderen Profile)
    const ev = getEvents().find(e => e.id === eventId);
    const srcCal = ev?.__calId || ev?.calendar_id;
    const optsCal = cals
      .filter(c => !c.readOnly && !c.is_personal && c.myStatus === 'accepted' && c.id !== srcCal)
      .map(c => `<option value="cal:${c.id}">📅 ${esc(c.name)}</option>`);
    const optsUser = (allProfiles || [])
      .filter(p => p.id !== currentUser.id)
      .map(p => `<option value="usr:${p.id}">👤 ${esc((p.firstname ?? '') + ' ' + (p.lastname ?? ''))}</option>`);
    sel.innerHTML = `<option value="">– Ziel wählen –</option>` + optsCal.join('') + optsUser.join('');
  } catch (err) {
    list.innerHTML = `<div style="color:var(--accent);font-size:12px">Fehler: ${esc(err.message)}</div>`;
  }
}

window.addEventShareFromModal = async () => {
  const sel = document.getElementById('evShareTarget');
  const val = sel?.value;
  if (!val || !editingEventId) return;
  const [kind, id] = val.split(':');
  try {
    if (kind === 'cal') {
      await DB.shareEventWithCalendar(editingEventId, id, currentUser.id);
    } else if (kind === 'usr') {
      await DB.shareEventWithUser(editingEventId, id, currentUser.id);
    }
    showToast('Freigabe gespeichert.');
    refreshEventShareUI(editingEventId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

window.removeEventShare = async (shareId, eventId) => {
  try {
    await DB.unshareEvent(shareId);
    refreshEventShareUI(eventId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};
window.closeEventModal = () => {
  document.getElementById('eventModal').classList.remove('open');
  editingEventId = null;
};

window.saveEvent = async () => {
  const title = document.getElementById('ev-title').value.trim();
  const date  = document.getElementById('ev-date').value;
  if (!title || !date) return showToast('Titel und Datum sind Pflichtfelder.', 'error');

  const payload = {
    title,
    date,
    date_end:    document.getElementById('ev-date-end').value    || null,
    time:        document.getElementById('ev-time').value        || null,
    time_end:    document.getElementById('ev-time-end').value    || null,
    description: document.getElementById('ev-desc').value.trim()     || null,
    location:    document.getElementById('ev-location').value.trim() || null,
    color:       eventSelectedColor,
    roles:       currentRoles,
  };

  try {
    if (editingEventId) {
      await DB.updateEvent(editingEventId, payload);
      showToast('Termin aktualisiert!');
    } else {
      await DB.createEvent(currentUser.id, activeCalendarId, payload);
      showToast('Termin erstellt!');
    }
    closeEventModal();
    // Alle aktiven Kalender neu laden und Ansicht aktualisieren
    await refreshActiveCalendars();
    renderCurrentView();
    await renderMyEvents();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

// Alle aktuell sichtbaren Kalender aus der DB neu laden und den Cache updaten
async function refreshActiveCalendars() {
  const ids = Array.from(activeCalendarIds);
  await Promise.all(ids.map(async id => {
    const data = await DB.getCalendarDetails(id);
    loadedCalendars.set(id, data);
    if (id === activeCalendarId) activeCalendarData = data;
  }));
}

window.deleteEvent = async () => {
  if (!editingEventId) return;
  if (!confirm('Termin wirklich löschen?')) return;
  try {
    await DB.deleteEvent(editingEventId);
    closeEventModal();
    await refreshActiveCalendars();
    renderCurrentView();
    showToast('Termin gelöscht.');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

// ── Rollen ───────────────────────────────────────────────────
function renderRolesList() {
  const members = (activeCalendarData?.members ?? [])
    .filter(m => m.status === 'accepted')
    .map(m => m.profiles ?? m);

  document.getElementById('rolesList').innerHTML = currentRoles.map((r, i) => {
    const opts = members.map(p =>
      `<option value="${p.id}" ${p.id === r.assignedUserId ? 'selected' : ''}>
        ${esc(p.firstname + ' ' + p.lastname)}
      </option>`
    ).join('');
    const isFilled = !!r.assignedUserId;
    return `<div class="role-row ${isFilled?'filled':'unfilled'}">
      <div class="role-status-dot ${isFilled?'filled':'unfilled'}"></div>
      <input class="role-name-select" value="${esc(r.name)}" placeholder="Rolle z.B. Moderator"
        onchange="updateRole(${i},'name',this.value)" />
      <select class="role-member-select" onchange="updateRole(${i},'assignedUserId',this.value)">
        <option value="">— Niemand —</option>${opts}
      </select>
      <button class="role-remove-btn" onclick="removeRole(${i})">✕</button>
    </div>`;
  }).join('');
}
window.addRoleRow     = () => { currentRoles.push({ name: '', assignedUserId: null }); renderRolesList(); };
window.removeRole     = i => { currentRoles.splice(i, 1); renderRolesList(); };
window.updateRole     = (i, field, val) => { currentRoles[i][field] = val || null; renderRolesList(); };

// ── Einstellungen ─────────────────────────────────────────────
window.openCalSettings = () => {
  settingsCalId = activeCalendarId;
  renderSettings('general');
  document.getElementById('settingsNavTitle').textContent = activeCalendarData?.name ?? '';
  document.getElementById('settingsNavDot').style.background = activeCalendarData?.color ?? '#5B5FEF';
  showScreen('settings');
};
window.closeSettings = () => showScreen('calendar');

window.setSettingsTab = tab => {
  document.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.id === 'stab-' + tab));
  renderSettings(tab);
};

function renderSettings(tab) {
  const cal     = activeCalendarData;
  const members = cal?.members ?? [];
  const body    = document.getElementById('settingsBody');

  if (tab === 'general') {
    body.innerHTML = `
      <div class="settings-card">
        <div class="settings-card-title">Kalender bearbeiten</div>
        <div class="field" style="margin-bottom:14px"><label>Name</label><input id="set-name" value="${esc(cal?.name??'')}" /></div>
        <div class="field" style="margin-bottom:14px"><label>Beschreibung</label><textarea id="set-desc" rows="2" style="padding:11px 13px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:inherit;resize:none;outline:none">${esc(cal?.description??'')}</textarea></div>
        <div class="field"><label>Farbe</label><div class="color-picker" id="settingsColorPicker"></div></div>
      </div>
      <div class="settings-card" style="border-color:#FFD0D0">
        <div class="settings-card-title" style="color:var(--accent)">Gefahrenzone</div>
        <button class="btn-danger" onclick="confirmDeleteCalendar()">🗑 Kalender löschen</button>
      </div>`;
    // Farbpicker aufbauen
    const cp = document.getElementById('settingsColorPicker');
    cp.innerHTML = CAL_COLORS.map(c =>
      `<div class="color-dot ${c===(cal?.color??'')?'selected':''}" style="background:${c}" onclick="selectSettingsColor('${c}',this)"></div>`
    ).join('');
    selectedColor = cal?.color ?? CAL_COLORS[0];
  } else if (tab === 'members') {
    const myRole = members.find(m => m.user_id === currentUser?.id)?.role;
    const canManage = ['owner','admin'].includes(myRole);
    body.innerHTML = `
      <div class="settings-card">
        <div class="settings-card-title">Mitglieder (${members.length})
          ${canManage ? `<button class="btn-primary" style="font-size:12px;padding:6px 12px" onclick="openInviteDialog()">+ Einladen</button>` : ''}
        </div>
        ${members.map(m => {
          const p = m.profiles ?? m;
          const name = `${p.firstname??''} ${p.lastname??''}`.trim() || 'Unbekannt';
          return `<div class="member-row">
            <div class="member-ava">${p.avatar??'??'}</div>
            <div class="member-info"><div class="name">${esc(name)}</div><div class="email">${m.status==='pending'?'⏳ Einladung ausstehend':''}</div></div>
            <span class="role-badge ${{owner:'role-owner',admin:'role-admin',member:'role-member'}[m.role]??'role-member'}">${{owner:'Ersteller',admin:'Admin',member:'Mitglied'}[m.role]??'Mitglied'}</span>
            ${canManage && m.user_id !== currentUser?.id ? `<button class="btn-danger" style="padding:5px 10px;font-size:11px" onclick="removeMemberUI('${m.user_id}')">✕</button>` : ''}
          </div>`;
        }).join('')}
      </div>`;
  } else if (tab === 'sharing') {
    renderSharingTab();
  }
}

// Sharing-Tab: zeigt wem dieser Kalender bereits gezeigt wird und erlaubt
// das Freigeben an weitere Kalender, in denen der aktuelle Nutzer Mitglied ist.
async function renderSharingTab() {
  const body  = document.getElementById('settingsBody');
  const cal   = activeCalendarData;
  const myRole = (cal?.members ?? []).find(m => m.user_id === currentUser?.id)?.role;
  const canShare = ['owner','admin'].includes(myRole);

  body.innerHTML = `
    <div class="settings-card">
      <div class="settings-card-title">Kalender teilen</div>
      <div style="font-size:13px;color:var(--text-sub);margin-bottom:14px;line-height:1.5">
        Teile diesen Kalender mit einem anderen Kalender <strong>oder</strong> einem einzelnen Nutzer.
        Empfänger dürfen die Termine <strong>nur lesen</strong>. An Nutzer freigegebene Kalender
        erscheinen im privaten Kalender des Empfängers.
      </div>
      <div id="sharingList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
        <div style="color:var(--text-muted);font-size:13px">Lädt...</div>
      </div>
      ${canShare ? `
        <div style="display:flex;gap:8px;align-items:center">
          <select id="shareTargetSelect" class="role-name-select" style="flex:1;padding:9px 12px"></select>
          <button class="btn-primary" style="padding:9px 16px" onclick="shareWithSelected()">＋ Freigeben</button>
        </div>
      ` : `<div style="font-size:13px;color:var(--text-muted)">Nur Admins oder der Ersteller können Freigaben verwalten.</div>`}
    </div>`;

  try {
    const [shares, allCals] = await Promise.all([
      DB.getCalendarSharesOf(settingsCalId),
      DB.getCalendars(currentUser.id),
    ]);
    const listEl = document.getElementById('sharingList');
    if (!shares.length) {
      listEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:10px 0">Dieser Kalender ist noch mit niemandem geteilt.</div>`;
    } else {
      listEl.innerHTML = shares.map(s => {
        const isUser = !!s.target_user_id;
        const c = s.calendars;
        const p = s.profiles;
        const label = isUser
          ? `👤 ${esc(((p?.firstname ?? '') + ' ' + (p?.lastname ?? '')).trim() || 'Nutzer')}`
          : `📅 ${esc(c?.name || 'Kalender')}`;
        const sub   = isUser
          ? 'erscheint im privaten Kalender dieses Nutzers'
          : 'Mitglieder dieses Kalenders können lesen';
        const dot   = isUser ? '#5B5FEF' : (c?.color || '#999');
        return `<div class="member-row" style="padding:10px 12px;background:var(--bg);border-radius:var(--radius-sm);border-bottom:none">
          <div class="navbar-cal-dot" style="background:${dot};width:14px;height:14px;border-radius:50%"></div>
          <div class="member-info" style="flex:1">
            <div class="name">${label}</div>
            <div class="email">${sub}</div>
          </div>
          ${canShare ? `<button class="btn-danger" style="padding:5px 10px;font-size:11px" onclick="unshareCalendarUI('${s.id}')">✕ Entfernen</button>` : ''}
        </div>`;
      }).join('');
    }

    if (canShare) {
      const sel = document.getElementById('shareTargetSelect');
      const alreadyCal  = new Set(shares.filter(s => s.target_calendar_id).map(s => s.target_calendar_id));
      const alreadyUser = new Set(shares.filter(s => s.target_user_id).map(s => s.target_user_id));
      const calCands = allCals.filter(c =>
        c.myStatus === 'accepted' && !c.isShared && !c.is_personal && c.id !== settingsCalId && !alreadyCal.has(c.id)
      );
      const userCands = (allProfiles || []).filter(p =>
        p.id !== currentUser.id && !alreadyUser.has(p.id)
      );
      const optsCal  = calCands.map(c => `<option value="cal:${c.id}">📅 ${esc(c.name)}</option>`).join('');
      const optsUser = userCands.map(p => `<option value="usr:${p.id}">👤 ${esc(((p.firstname ?? '') + ' ' + (p.lastname ?? '')).trim())}</option>`).join('');
      sel.innerHTML = `<option value="">– Ziel wählen –</option>` + optsCal + optsUser;
      sel.disabled = !optsCal && !optsUser;
    }
  } catch (err) {
    document.getElementById('sharingList').innerHTML =
      `<div style="color:var(--accent);font-size:13px">Fehler beim Laden: ${esc(err.message)}</div>`;
  }
}

window.shareWithSelected = async () => {
  const sel = document.getElementById('shareTargetSelect');
  const val = sel?.value;
  if (!val) return;
  const [kind, id] = val.split(':');
  try {
    if (kind === 'cal') {
      await DB.shareCalendarWith(settingsCalId, id, currentUser.id);
    } else if (kind === 'usr') {
      await DB.shareCalendarWithUser(settingsCalId, id, currentUser.id);
    }
    showToast('Kalender freigegeben.');
    renderSharingTab();
  } catch (err) {
    showToast('Fehler beim Freigeben: ' + err.message, 'error');
  }
};

window.unshareCalendarUI = async shareId => {
  if (!confirm('Freigabe wirklich zurückziehen?')) return;
  try {
    await DB.unshareCalendar(shareId);
    showToast('Freigabe entfernt.');
    renderSharingTab();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

window.selectSettingsColor = (color, el) => {
  selectedColor = color;
  document.querySelectorAll('#settingsColorPicker .color-dot').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
};

window.saveSettings = async () => {
  const name = document.getElementById('set-name')?.value.trim();
  const desc = document.getElementById('set-desc')?.value.trim();
  if (!name) return showToast('Name darf nicht leer sein.', 'error');
  try {
    await DB.updateCalendar(settingsCalId, { name, description: desc, color: selectedColor });
    const fresh = await DB.getCalendarDetails(settingsCalId);
    loadedCalendars.set(settingsCalId, fresh);
    if (settingsCalId === activeCalendarId) activeCalendarData = fresh;
    // Auch die Kalender-Liste für die Auswahlleiste aktualisieren
    const idx = allCalendars.findIndex(c => c.id === settingsCalId);
    if (idx >= 0) allCalendars[idx] = { id: fresh.id, name: fresh.name, color: fresh.color };
    updateCalNavTitle();
    renderCalendarStrip();
    closeSettings();
    showToast('Einstellungen gespeichert!');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

window.confirmDeleteCalendar = async () => {
  if (!confirm(`Kalender "${activeCalendarData?.name}" wirklich löschen? Alle Termine werden gelöscht.`)) return;
  try {
    await DB.deleteCalendar(settingsCalId);
    activeCalendarId   = null;
    activeCalendarData = null;
    closeSettings();
    await goHome();
    showToast('Kalender gelöscht.');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

window.openInviteDialog = () => {
  const email = prompt('E-Mail-Adresse des einzuladenden Nutzers:');
  if (!email) return;
  inviteByEmail(email.trim().toLowerCase());
};

async function inviteByEmail(email) {
  try {
    const profile = allProfiles.find(p => p.email === email);
    if (!profile) {
      showToast('Kein Nutzer mit dieser E-Mail gefunden. Er muss sich zuerst registrieren.', 'error');
      return;
    }
    await DB.inviteMember(activeCalendarId, profile.id);
    activeCalendarData = await DB.getCalendarDetails(activeCalendarId);
    loadedCalendars.set(activeCalendarId, activeCalendarData);
    renderSettings('members');
    showToast('Einladung gesendet!');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

window.removeMemberUI = async userId => {
  if (!confirm('Mitglied wirklich entfernen?')) return;
  try {
    await DB.removeMember(activeCalendarId, userId);
    activeCalendarData = await DB.getCalendarDetails(activeCalendarId);
    loadedCalendars.set(activeCalendarId, activeCalendarData);
    renderSettings('members');
    showToast('Mitglied entfernt.');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

// ── App starten ───────────────────────────────────────────────
DB.onAuthChange(async user => {
  if (user) {
    const fullUser = await DB.getCurrentUser();
    if (fullUser) await enterApp(fullUser);
  } else {
    if (currentUser) {
      currentUser = null;
      showScreen('auth');
    }
  }
});
