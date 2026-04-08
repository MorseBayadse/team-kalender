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
  // Profile für Mitglieder-Anzeige vorladen
  allProfiles = await DB.getProfiles().catch(() => []);

  document.getElementById('navAvatar').textContent = user.avatar ?? '??';
  document.getElementById('dropdownName').textContent = `${user.firstname} ${user.lastname}`;
  document.getElementById('dropdownEmail').textContent = user.email;

  showScreen('home');
  await Promise.all([renderInvites(), renderCalendars(), renderMyEvents()]);
}

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
          <div class="my-event-title">${esc(ev.title)}</div>
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
    activeCalendarData = await DB.getCalendarDetails(id);
    activeCalendarId   = id;
    viewYear  = new Date().getFullYear();
    viewMonth = new Date().getMonth();
    selectedDay = null;
    document.getElementById('calNavTitle').textContent = activeCalendarData.name;
    document.getElementById('calNavDot').style.background = activeCalendarData.color;
    showScreen('calendar');
    setCalView('month');
  } catch (err) {
    showToast('Kalender konnte nicht geladen werden: ' + err.message, 'error');
  }
};
window.goHome = async () => {
  activeCalendarId = null;
  activeCalendarData = null;
  selectedDay = null;
  showScreen('home');
  await Promise.all([renderInvites(), renderCalendars(), renderMyEvents()]);
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
function getEvents() { return activeCalendarData?.events ?? []; }

function renderMonth() {
  const label = document.getElementById('monthLabelText');
  label.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay  = new Date(viewYear, viewMonth + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Mo=0
  const today    = toDateStr(new Date());
  const events   = getEvents();

  let html = '';
  let day = 1 - startDow;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const d    = new Date(viewYear, viewMonth, day);
      const ds   = toDateStr(d);
      const otherMonth = d.getMonth() !== viewMonth;
      const dayEvs = events.filter(e => e.date === ds || (e.date <= ds && e.date_end >= ds));
      const cls = ['cal-day', otherMonth?'other-month':'', ds===today?'today':'', ds===selectedDay?'selected':''].filter(Boolean).join(' ');
      html += `<div class="${cls}" onclick="selectDay('${ds}')">
        <div class="day-num">${d.getDate()}</div>
        ${dayEvs.slice(0,3).map(ev => `<div class="ev-pill" style="background:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="event.stopPropagation();openEventModal('${ev.id}')">${esc(ev.title)}</div>`).join('')}
        ${dayEvs.length > 3 ? `<div class="ev-more">+${dayEvs.length-3} mehr</div>` : ''}
      </div>`;
      day++;
    }
    if (day > lastDay.getDate() + startDow) break;
  }
  document.getElementById('calGrid').innerHTML = html;
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
  document.getElementById('dayPanelTitle').textContent = d.toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('dayEvents').innerHTML = dayEvs.length === 0
    ? '<div class="no-events">Keine Termine</div>'
    : dayEvs.map(ev => `<div class="day-event-item" style="border-left-color:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">
        <div class="day-event-time">${ev.time ? ev.time.slice(0,5) : '—'}</div>
        <div>
          <div class="day-event-title">${esc(ev.title)}</div>
          ${ev.location ? `<div class="day-event-desc">📍 ${esc(ev.location)}</div>` : ''}
        </div>
      </div>`).join('');
}

// ── Jahresansicht ────────────────────────────────────────────
function renderYearView() {
  document.getElementById('monthLabelText').textContent = viewYear;
  const grid = document.getElementById('yearGrid');
  const events = getEvents();
  let html = '';
  for (let m = 0; m < 12; m++) {
    const mn   = new Date(viewYear, m, 1).toLocaleDateString('de-DE', { month: 'long' });
    const fd   = new Date(viewYear, m, 1);
    const ld   = new Date(viewYear, m + 1, 0);
    const sdow = (fd.getDay() + 6) % 7;
    const today = toDateStr(new Date());
    let cells = '';
    let day = 1 - sdow;
    for (let i = 0; i < 35; i++) {
      const d   = new Date(viewYear, m, day);
      const ds  = toDateStr(d);
      const valid = d.getMonth() === m;
      const evs = valid ? events.filter(e => e.date === ds) : [];
      const isToday = ds === today && valid;
      cells += `<div class="mini-day${isToday?' today-mini':''}" onclick="valid&&selectDayYear('${ds}')">
        <div class="mini-day-num">${valid ? d.getDate() : ''}</div>
        <div class="mini-dot-row">${evs.slice(0,3).map(e=>`<div class="mini-dot" style="background:${e.color||activeCalendarData?.color||'#5B5FEF'}"></div>`).join('')}</div>
      </div>`;
      day++;
    }
    html += `<div class="mini-month">
      <div class="mini-month-title">${mn}</div>
      <div class="mini-month-grid">${cells}</div>
    </div>`;
  }
  grid.innerHTML = html;
}
window.selectDayYear = ds => {
  const d = new Date(ds + 'T00:00:00');
  viewMonth = d.getMonth();
  selectedDay = ds;
  setCalView('month');
};

// ── Wochenansicht ────────────────────────────────────────────
function renderWeekView() {
  if (!viewWeek) viewWeek = getMondayOf(toDateStr(new Date()));
  const today  = toDateStr(new Date());
  const events = getEvents();
  const HOURS  = 24;
  const H      = 48;
  const days   = Array.from({length:7}, (_,i) => dayAddDays(viewWeek, i));
  const start  = new Date(days[0]+'T00:00:00');
  const end    = new Date(days[6]+'T00:00:00');
  document.getElementById('monthLabelText').textContent =
    start.toLocaleDateString('de-DE',{day:'numeric',month:'short'}) + ' – ' +
    end.toLocaleDateString('de-DE',{day:'numeric',month:'short',year:'numeric'});

  document.getElementById('weekDayHeaders').innerHTML = days.map(ds => {
    const d   = new Date(ds+'T00:00:00');
    const cls = ds === today ? 'week-day-header today-col' : 'week-day-header';
    return `<div class="${cls}">
      <div class="wdh-dow">${d.toLocaleDateString('de-DE',{weekday:'short'})}</div>
      <div class="wdh-num">${d.getDate()}</div>
    </div>`;
  }).join('');

  let timecol = '';
  for (let h = 0; h < HOURS; h++) {
    timecol += `<div class="week-time-slot">${String(h).padStart(2,'0')}:00</div>`;
  }
  document.getElementById('weekTimeCol').innerHTML = timecol;

  document.getElementById('weekDaysGrid').style.gridTemplateColumns = `repeat(7,1fr)`;
  document.getElementById('weekDaysGrid').innerHTML = days.map(ds => {
    const dayEvs = events.filter(e => e.date === ds && e.time);
    const lines  = Array.from({length:HOURS}, (_,h) => `<div class="week-hour-line" style="top:${h*H}px"></div>`).join('');
    const blocks = dayEvs.map(ev => {
      const [hh,mm] = (ev.time||'00:00').split(':').map(Number);
      const top = (hh*60+mm)/60*H;
      const dur = ev.time_end ? (() => { const [eh,em]=(ev.time_end||'01:00').split(':').map(Number); return ((eh*60+em)-(hh*60+mm))/60*H; })() : H;
      return `<div class="week-event-block" style="top:${top}px;height:${Math.max(dur,20)}px;left:4px;right:4px;background:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">${esc(ev.title)}</div>`;
    }).join('');
    return `<div class="week-day-col" style="height:${HOURS*H}px">${lines}${blocks}</div>`;
  }).join('');
}

// ── Tagesansicht ─────────────────────────────────────────────
function renderDayView() {
  const ds     = selectedDay || toDateStr(new Date());
  const d      = new Date(ds+'T00:00:00');
  const events = getEvents().filter(e => e.date === ds);
  const H      = 60;
  document.getElementById('monthLabelText').textContent = d.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dayViewHeader').textContent = d.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});

  let timecol = '';
  for (let h = 0; h < 24; h++) timecol += `<div class="day-view-time-slot">${String(h).padStart(2,'0')}:00</div>`;
  document.getElementById('dayViewTimecol').innerHTML = timecol;

  const col  = document.getElementById('dayViewEventsCol');
  col.style.position = 'relative';
  col.style.height   = 24*H + 'px';
  const blocks = events.filter(e => e.time).map(ev => {
    const [hh,mm] = (ev.time||'00:00').split(':').map(Number);
    const top = (hh*60+mm)/60*H;
    const dur = ev.time_end ? (() => { const [eh,em]=(ev.time_end||'01:00').split(':').map(Number); return ((eh*60+em)-(hh*60+mm))/60*H; })() : H;
    return `<div class="day-event-timed" style="top:${top}px;height:${Math.max(dur,28)}px;left:8px;right:8px;background:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">
      ${esc(ev.title)}${ev.time?' · '+ev.time.slice(0,5):''}
    </div>`;
  }).join('');
  const now  = new Date();
  const nowT = (now.getHours()*60+now.getMinutes())/60*H;
  col.innerHTML = blocks + (ds === toDateStr(now) ? `<div class="day-now-line" style="top:${nowT}px"></div>` : '');
}

// ── "Meine Termine"-Ansicht ───────────────────────────────────
function renderMineView() {
  document.getElementById('monthLabelText').textContent = 'Meine Termine';
  const today  = toDateStr(new Date());
  const events = getEvents()
    .filter(e => e.date >= today)
    .sort((a,b) => (a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
  const myRoleEvs = events.filter(e =>
    (e.event_roles||[]).some(r => r.assigned_user_id === currentUser?.id)
  );
  document.getElementById('mineViewLabel').textContent = myRoleEvs.length + ' bevorstehende Termine mit meiner Rolle';
  document.getElementById('mineViewList').innerHTML = myRoleEvs.map(ev => {
    const d = new Date(ev.date+'T00:00:00');
    const role = (ev.event_roles||[]).find(r => r.assigned_user_id === currentUser?.id);
    return `<div class="my-event-row" style="border-left-color:${ev.color||activeCalendarData?.color||'#5B5FEF'}" onclick="openEventModal('${ev.id}')">
      <div class="my-event-date-badge"><div class="day">${d.getDate()}</div><div class="mon">${d.toLocaleDateString('de-DE',{month:'short'})}</div></div>
      <div style="flex:1"><div class="my-event-title">${esc(ev.title)}</div><div class="my-event-meta">${ev.time?ev.time.slice(0,5):''}</div></div>
      ${role ? `<span class="role-badge role-member">🎭 ${esc(role.name)}</span>` : ''}
    </div>`;
  }).join('') || '<div class="no-events">Keine Termine mit deiner Rolle</div>';
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
  document.getElementById('eventModal').classList.add('open');
  setTimeout(() => document.getElementById('ev-title').focus(), 100);
};

window.openEventModal = id => {
  const ev = getEvents().find(e => e.id === id);
  if (!ev) return;
  editingEventId = id;
  document.getElementById('eventModalTitle').textContent = 'Termin bearbeiten';
  document.getElementById('ev-title').value       = ev.title;
  document.getElementById('ev-date').value        = ev.date;
  document.getElementById('ev-date-end').value    = ev.date_end || '';
  document.getElementById('ev-time').value        = ev.time || '';
  document.getElementById('ev-time-end').value    = ev.time_end || '';
  document.getElementById('ev-desc').value        = ev.description || '';
  document.getElementById('ev-location').value    = ev.location || '';
  document.getElementById('evDeleteBtn').style.display = 'inline-flex';
  buildEventColorPicker(ev.color || activeCalendarData?.color || CAL_COLORS[0]);
  currentRoles = (ev.event_roles || []).map(r => ({ name: r.name, assignedUserId: r.assigned_user_id }));
  renderRolesList();
  document.getElementById('eventModal').classList.add('open');
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
    // Kalender neu laden und Ansicht aktualisieren
    activeCalendarData = await DB.getCalendarDetails(activeCalendarId);
    renderCurrentView();
    await renderMyEvents();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
};

window.deleteEvent = async () => {
  if (!editingEventId) return;
  if (!confirm('Termin wirklich löschen?')) return;
  try {
    await DB.deleteEvent(editingEventId);
    closeEventModal();
    activeCalendarData = await DB.getCalendarDetails(activeCalendarId);
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
  } else {
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
  }
}

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
    activeCalendarData = await DB.getCalendarDetails(settingsCalId);
    document.getElementById('calNavTitle').textContent = activeCalendarData.name;
    document.getElementById('calNavDot').style.background = activeCalendarData.color;
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
