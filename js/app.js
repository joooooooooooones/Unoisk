import { createTransport, makeCode, normalizeCode } from './net.js';
import { Host, TARGETS, cleanName } from './host.js';
import { COLORS, cardName, colorName, MAX_PLAYERS } from './game.js';
import { AVATARS, validAvatar } from './avatars.js';
import { measure, animateChanges, hideInFlight } from './fx.js';

const params = new URLSearchParams(location.search);
const isLocal = params.has('lokal');
// I testtilstand deler fanerne ikke identitet, så hver fane er sin egen spiller.
const storage = isLocal ? sessionStorage : localStorage;
const KEYS = {
  id: 'unoisk.id',
  name: 'unoisk.name',
  avatar: 'unoisk.avatar',
  session: 'unoisk.session',
  host: 'unoisk.host',
};

function load(key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Privat browsing e.l. – spillet virker stadig, men kan ikke genoptages.
  }
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

const transport = createTransport();
const app = document.getElementById('app');
const toasts = document.getElementById('toasts');

const S = {
  me: load(KEYS.id) || newId(),
  name: load(KEYS.name) || '',
  avatar: validAvatar(load(KEYS.avatar)),
  screen: 'home', // home | connecting | play
  role: null, // host | client
  code: null,
  view: null,
  host: null,
  link: null,
  conn: null,
  online: false,
  notice: '',
  picking: null,
  selectedAt: 0,
  selected: [], // kort valgt til at blive lagt sammen (samme tal/symbol)
  showRules: false,
  showInvite: false,
  lastLogId: 0,
  flashLog: false,
  lastRound: 0,
  lastGame: null, // spillet ved sidste opdatering – til animationerne
  wasMyTurn: false,
  retry: null,
};
save(KEYS.id, S.me);

// ---------- Forbindelse ----------

function retryLater(fn, ms) {
  clearTimeout(S.retry);
  S.retry = setTimeout(fn, ms);
}

function startHost(code, saved = null) {
  S.role = 'host';
  S.code = code;
  S.screen = 'connecting';
  S.online = false;
  S.host = new Host({
    code,
    me: { id: S.me, name: S.name, emoji: S.avatar },
    saved,
    onView: (view, msg) => (view ? setView(view) : handleMessage(msg)),
    onSave: (snapshot) => save(KEYS.host, snapshot),
  });
  save(KEYS.session, { role: 'host', code });
  if (saved)
    S.host.broadcast(); // vis det gemte spil med det samme
  else render();
  openHostLink(!saved);
}

function openHostLink(fresh) {
  let ready = false;
  S.link?.close();
  S.link = transport.host(S.code, {
    onReady: () => {
      ready = true;
      S.online = true;
      S.host.broadcast();
    },
    onConnection: (conn) => S.host.addConnection(conn),
    onError: (err) => {
      if (ready && err === 'network') return; // PeerJS genopretter selv forbindelsen
      S.online = false;
      if (err === 'code-taken' && fresh && S.host.roster.length === 1) {
        // Koden er i brug af et andet spil – vælg en ny.
        S.code = S.host.code = makeCode();
        save(KEYS.session, { role: 'host', code: S.code });
        return openHostLink(true);
      }
      // Efter genindlæsning kan den gamle forbindelse holde koden et øjeblik.
      render();
      retryLater(() => openHostLink(false), 3000);
    },
  });
}

function startClient(code, resuming = false) {
  S.role = 'client';
  S.code = code;
  S.online = false;
  if (!S.view) S.screen = 'connecting';
  save(KEYS.session, { role: 'client', code });
  render();

  S.link?.close();
  S.link = transport.join(code, {
    onOpen: (conn) => {
      S.conn = conn;
      conn.onData(handleMessage);
      conn.onClose(() => {
        if (S.conn !== conn) return;
        S.conn = null;
        S.online = false;
        render();
        retryLater(() => startClient(S.code, true), 1500);
      });
      conn.send({ t: 'join', id: S.me, name: S.name, emoji: S.avatar });
    },
    onError: (err) => {
      if (S.role !== 'client') return;
      if (err === 'not-found' && !resuming && !S.view) {
        S.lastCode = code;
        leaveGame(`Fandt intet spil med koden ${code}. Tjek koden og prøv igen.`);
        return;
      }
      S.online = false;
      render();
      retryLater(() => startClient(S.code, true), 2500);
    },
  });
}

function handleMessage(msg) {
  switch (msg?.t) {
    case 'state':
      S.online = true;
      return setView(msg.view);
    case 'error':
      return toast(msg.msg, 'error');
    case 'rejected':
      return leaveGame(msg.msg);
    case 'kicked':
      return leaveGame('Værten fjernede dig fra spillet.');
    case 'ended':
      return leaveGame('Værten afsluttede spillet.');
  }
}

// Spærrer kort tid efter et træk, så et hurtigt dobbelttryk ikke bliver til Træk + Pas.
const TAP_GUARD_MS = 400;
const GUARDED = new Set(['play', 'draw', 'pass']);
let guardUntil = 0;

function send(action) {
  if (GUARDED.has(action.type)) {
    if (Date.now() < guardUntil) return;
    guardUntil = Date.now() + TAP_GUARD_MS;
  }
  if (S.role === 'host') S.host.act(S.me, action);
  else if (S.conn) S.conn.send({ t: 'action', action });
  else toast('Ingen forbindelse – prøver igen…', 'error');
}

function leaveGame(notice = '') {
  clearTimeout(S.retry);
  const { link, conn, host, role } = S;
  S.role = null;
  S.conn = null;
  S.host = null;
  if (role === 'client' && conn && !notice) conn.send({ t: 'leave' });
  if (host) host.shutdown();
  setTimeout(() => link?.close(), 400);
  save(KEYS.session, null);
  if (role === 'host') save(KEYS.host, null);
  Object.assign(S, {
    link: null,
    view: null,
    screen: 'home',
    notice,
    picking: null,
    lastRound: 0,
    lastLogId: 0,
    lastGame: null,
  });
  releaseWakeLock();
  render();
}

// ---------- Tilstand ----------

function setView(view) {
  const first = !S.view;
  // Fra lobbyen til første runde: en tom "runde 0", så kortene deles ud.
  const prevGame = S.lastGame ?? (S.view && view.game ? { round: 0 } : null);
  // Hos værten deler visningen hånd med selve spillet, så gem en kopi til næste sammenligning.
  S.lastGame = view.game ? { ...view.game, hand: [...view.game.hand] } : null;
  S.view = view;
  S.screen = 'play';
  const g = view.game;
  if (g) {
    if (g.round !== S.lastRound) {
      S.lastRound = g.round;
      S.lastLogId = 0;
    }
    const latest = g.log.at(-1)?.id ?? 0;
    S.flashLog = !first && latest > S.lastLogId;
    S.lastLogId = Math.max(S.lastLogId, latest);

    const myTurn = g.phase === 'playing' && g.currentId === S.me;
    if (myTurn && !S.wasMyTurn) navigator.vibrate?.(120);
    S.wasMyTurn = myTurn;
    if (S.picking !== null && !g.playable.includes(S.picking)) S.picking = null;
    if (!myTurn || !g.playable.includes(S.selected[0]) || S.selected.some((id) => !g.hand.some((c) => c.id === id))) {
      S.selected = [];
    }
  }
  keepAwake();
  render(prevGame);
}

// ---------- Hjælpere ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Faste avatarfarver, der ikke kan forveksles med kortfarverne.
const AVATAR_COLORS = [
  '#8e44ad',
  '#d35400',
  '#00897b',
  '#c2185b',
  '#5e35b1',
  '#6d4c41',
  '#00838f',
  '#ad1457',
  '#546e7a',
  '#7b1fa2',
];

function avatarColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const avatar = (p, cls = '') =>
  p.emoji
    ? `<span class="avatar emoji ${cls}" aria-hidden="true">${esc(p.emoji)}</span>`
    : `<span class="avatar ${cls}" style="--avatar:${avatarColor(p.id)}" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>`;
const genitive = (name) => (/[sxz]$/i.test(name) ? `${name}'` : `${name}s`);

const TARGET_LABELS = { 100: 'Hurtigt', 200: 'Kortere', 300: 'Mellem', 500: 'Officielt' };

const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '', wild4: '+4' };
const COLOR_ORDER = [...COLORS, null];
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];

function sortHand(hand) {
  return [...hand].sort(
    (a, b) =>
      COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color) ||
      VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value) ||
      a.id - b.id,
  );
}

// label: tekst til skærmlæsere; null = rent pynt (skjules for skærmlæsere).
function cardHTML(card, { cls = '', act = '', order = 0, label = cardName(card) } = {}) {
  const sym = SYMBOLS[card.value] ?? card.value;
  const color = card.color ? `c-${card.color}` : 'c-wild';
  const under = card.value === '6' || card.value === '9' ? ' under' : '';
  const tag = act ? 'button' : 'div';
  let attrs = ` data-cid="${card.id}"`;
  if (act) attrs += ` data-act="${act}" data-id="${card.id}" type="button"`;
  if (order) attrs += ` data-order="${order}"`;
  if (label === null) attrs += ' aria-hidden="true"';
  else attrs += `${act ? '' : ' role="img"'} aria-label="${esc(label)}"`;
  return `<${tag} class="card ${color} v-${card.value} ${cls}"${attrs}>
    <span class="corner tl${under}" aria-hidden="true">${sym}</span>
    <span class="oval" aria-hidden="true"><span class="sym${under}">${sym}</span></span>
    <span class="corner br${under}" aria-hidden="true">${sym}</span>
  </${tag}>`;
}

// QR-kode som SVG (biblioteket vendor/qrcode.js lægger 'qrcode' globalt).
function qrSVG(text) {
  if (typeof qrcode !== 'function') return '';
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 4; // hvid kant, så kameraet kan finde koden
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img" aria-label="QR-kode til at deltage i spillet" shape-rendering="crispEdges">
    <rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function shareLink(code) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('rum', code);
  if (isLocal) url.searchParams.set('lokal', '');
  return url.toString();
}

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  toasts.append(el);
  while (toasts.children.length > 3) toasts.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

let wakeLock = null;
async function keepAwake() {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {
    // Ikke understøttet / ikke tilladt – ikke kritisk.
  }
}
function releaseWakeLock() {
  wakeLock?.release();
  wakeLock = null;
}

// ---------- Visning ----------

let lastSheets = '';

// Nøgle for det element, der har fokus, så fokus kan sættes igen efter en omtegning.
function focusKey(el) {
  if (!el || !app.contains(el) || !el.dataset?.act) return el?.id ? `#${el.id}` : null;
  const d = el.dataset;
  return `[data-act="${d.act}"]${['id', 'emoji', 'color', 'target']
    .filter((k) => d[k] !== undefined)
    .map((k) => `[data-${k}="${CSS.escape(d[k])}"]`)
    .join('')}`;
}

// prevGame: spillet, som det så ud før denne opdatering – så ændringerne kan animeres.
function render(prevGame = null) {
  const focused = focusKey(document.activeElement);
  const handEl = app.querySelector('.hand');
  const scroll = handEl?.scrollLeft ?? 0;
  const before = prevGame && S.view?.game ? measure(app) : null;

  let html;
  if (S.screen === 'home') html = renderHome();
  else if (S.screen === 'connecting' || !S.view) html = renderConnecting();
  else if (S.view.game) html = renderGame(S.view);
  else html = renderLobby(S.view);

  if (S.screen === 'play' && !S.online) {
    const what = S.role === 'host' ? 'Din forbindelse er tabt' : 'Ingen forbindelse til værten';
    html += `<div class="banner" role="alert">${what} – prøver igen…</div>`;
  }
  if (S.showRules) html += renderRules();
  if (S.showInvite && S.view) html += renderInvite(S.view);
  app.innerHTML = html;
  S.flashLog = false;

  // Animér kun et ark, når det åbnes – ikke hver gang skærmen tegnes om.
  const sheets = [...app.querySelectorAll('.overlay')].map((o) => o.firstElementChild?.className ?? '').join('|');
  if (sheets !== lastSheets) app.querySelectorAll('.overlay').forEach((o) => o.classList.add('enter'));
  lastSheets = sheets;

  const newHand = app.querySelector('.hand');
  if (newHand) newHand.scrollLeft = scroll;
  if (before) {
    const faceHTML = (c) => cardHTML(c, { label: null });
    animateChanges(app, { prev: prevGame, next: S.view.game, me: S.me, before, faceHTML });
  }
  hideInFlight(app);
  if (focused && document.activeElement === document.body) {
    try {
      app.querySelector(focused)?.focus({ preventScroll: true });
    } catch {
      // ugyldig selektor – ingen fokus at genskabe
    }
  }
}

function renderHome() {
  const session = load(KEYS.session);
  const code = normalizeCode(params.get('rum')) || S.lastCode || '';
  const hero = [
    { id: -1, color: 'red', value: '7' },
    { id: -2, color: null, value: 'wild4' },
    { id: -3, color: 'blue', value: 'reverse' },
  ]
    .map((c) => cardHTML(c, { label: null }))
    .join('');
  return `<main class="home">
    <div class="hero" aria-hidden="true">${hero}</div>
    <h1 class="logo">UNO<span>isk</span></h1>
    <p class="tagline">UNO for hele familien – hver på sin telefon</p>
    ${S.notice ? `<p class="notice">${esc(S.notice)}</p>` : ''}
    <label class="field">Dit navn
      <input id="name" maxlength="16" value="${esc(S.name)}" placeholder="Fx Mormor" autocomplete="nickname" enterkeyhint="done">
    </label>
    <div class="avatar-pick" role="radiogroup" aria-label="Vælg din figur">
      ${AVATARS.map(
        (a) =>
          `<button type="button" role="radio" aria-checked="${a === S.avatar}" class="${a === S.avatar ? 'on' : ''}" data-act="avatar" data-emoji="${a}">${a}</button>`,
      ).join('')}
    </div>
    ${session ? `<button class="btn primary big" data-act="resume">Fortsæt spil ${esc(session.code)}</button>` : ''}
    <button class="btn ${session || code ? '' : 'primary'} big" data-act="create">Opret nyt spil</button>
    <div class="or"><span>eller deltag med en kode</span></div>
    <div class="join-row">
      <input id="code" maxlength="4" placeholder="ABCD" value="${esc(code)}" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go">
      <button class="btn ${code && !session ? 'primary' : ''}" data-act="join">Deltag</button>
    </div>
    <div id="install-slot">${installHTML()}</div>
    <button class="link" data-act="rules">Hvordan spiller man?</button>
  </main>`;
}

function renderConnecting() {
  const what = S.role === 'host' ? 'Opretter spil…' : `Forbinder til ${esc(S.code ?? '')}…`;
  return `<main class="center">
    <div class="spinner"></div>
    <p>${what}</p>
    <button class="btn ghost" data-act="leave">Annuller</button>
  </main>`;
}

function topBar(v) {
  const isHost = v.hostId === S.me;
  return `<header class="bar">
    <span class="logo small">UNO<span>isk</span></span>
    <button class="code-chip" data-act="invite" aria-label="Inviter flere – kode ${esc(v.code)}"><span>Kode</span> <b>${esc(v.code)}</b></button>
    <span class="bar-actions">
      <button class="icon" data-act="rules" aria-label="Regler">?</button>
      <button class="btn ghost small" data-act="leave">${isHost ? 'Afslut' : 'Forlad'}</button>
    </span>
  </header>`;
}

function renderLobby(v) {
  const isHost = v.hostId === S.me;
  const host = v.roster.find((p) => p.id === v.hostId);
  const s = v.settings;
  const checkbox = (key, label, hint) => `<label class="check">
      <input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''} ${isHost ? '' : 'disabled'}>
      <span><b>${label}</b><small>${hint}</small></span>
    </label>`;

  return `${topBar(v)}
  <main class="lobby">
    <section class="code-box">
      <div class="invite">
        ${qrSVG(shareLink(v.code))}
        <div>
          <div class="label">Scan med kameraet – eller skriv koden</div>
          <div class="big-code">${esc(v.code)}</div>
          <button class="btn small" data-act="share">Del link</button>
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>Spillere <span class="muted">${v.roster.length}/${MAX_PLAYERS}</span></h2>
      <ul class="roster">
        ${v.roster
          .map(
            (p) => `<li class="${p.connected ? '' : 'offline'}">
            ${avatar(p)}
            <span class="pname">${esc(p.name)}${p.id === v.hostId ? ' 👑' : ''}${p.id === S.me ? ' <span class="muted">(dig)</span>' : ''}</span>
            ${p.bot ? '<span class="tag">computer</span>' : ''}
            ${p.connected ? '' : '<span class="muted">offline</span>'}
            ${isHost && p.id !== S.me ? `<button class="x" data-act="kick" data-id="${esc(p.id)}" aria-label="Fjern ${esc(p.name)}">✕</button>` : ''}
          </li>`,
          )
          .join('')}
      </ul>
      ${
        isHost && v.roster.length < MAX_PLAYERS
          ? `<button class="btn ghost add-bot" data-act="add-bot">🤖 Tilføj computerspiller</button>
             ${v.roster.length < 3 ? '<p class="hint">Er I få? Computerspillere fylder bordet op – og man kan øve sig alene.</p>' : ''}`
          : ''
      }
    </section>
    <section class="panel">
      <h2>Spillets længde</h2>
      <div class="segmented" role="radiogroup" aria-label="Pointmål">
        ${TARGETS.map(
          (t) =>
            `<button type="button" role="radio" aria-checked="${(s.target ?? 500) === t}" class="${(s.target ?? 500) === t ? 'on' : ''}" data-act="target" data-target="${t}" ${isHost ? '' : 'disabled'}>
              <b>${t}</b><small>${TARGET_LABELS[t]}</small>
            </button>`,
        ).join('')}
      </div>
      <p class="hint">Den første, der når ${s.target ?? 500} point, vinder hele spillet.</p>
    </section>
    <section class="panel">
      <h2>Husregler</h2>
      ${checkbox('stacking', 'Stabling', '+2 og +4 kan lægges oven på hinanden')}
      ${checkbox('drawUntilPlayable', 'Træk til du kan', 'Bliv ved med at trække, indtil du får et kort, der passer')}
      ${checkbox('multiPlay', 'Læg flere ens', 'Har du flere kort med samme tal eller symbol, må du lægge dem på én gang – uanset farve')}
    </section>
    ${
      isHost
        ? `<button class="btn primary big" data-act="start" ${v.roster.length < 2 ? 'disabled' : ''}>${
            v.roster.length < 2 ? 'Venter på spillere…' : `Start spil med ${v.roster.length} spillere`
          }</button>`
        : `<p class="waiting">Venter på at ${esc(host?.name ?? 'værten')} starter spillet…</p>`
    }
  </main>`;
}

function renderGame(v) {
  const g = v.game;
  const isHost = v.hostId === S.me;
  const roster = Object.fromEntries(v.roster.map((p) => [p.id, p]));
  const myTurn = g.phase === 'playing' && g.currentId === S.me;
  const current = g.players.find((p) => p.id === g.currentId);
  const meInRound = g.players.find((p) => p.id === S.me);

  const idx = g.players.findIndex((p) => p.id === S.me);
  const others = idx < 0 ? g.players : [...g.players.slice(idx + 1), ...g.players.slice(0, idx)];

  const opponents = others
    .map((p, i) => {
      const connected = roster[p.id]?.connected ?? false;
      const turn = p.id === g.currentId;
      const label = `${p.name}: ${p.count} kort${turn ? ', har turen' : ''}${connected ? '' : ', offline'}`;
      return `${i > 0 ? `<span class="order" aria-hidden="true">${g.direction === 1 ? '›' : '‹'}</span>` : ''}
      <div class="opp ${turn ? 'turn' : ''} ${connected ? '' : 'offline'}" data-pid="${esc(p.id)}" role="group" aria-label="${esc(label)}">
        <div class="opp-face">
          ${avatar(roster[p.id] ?? p)}
          <span class="count" aria-hidden="true">${p.count}</span>
          ${p.count === 1 && p.saidUno ? '<span class="badge">UNO</span>' : ''}
        </div>
        <div class="oname" aria-hidden="true">${esc(p.name)}</div>
        ${connected ? '' : '<div class="ostate" aria-hidden="true">offline</div>'}
        ${isHost && !connected ? `<button class="btn tiny" data-act="kick" data-id="${esc(p.id)}">Fjern</button>` : ''}
      </div>`;
    })
    .join('');

  const currentOffline = current && !(roster[current.id]?.connected ?? true);
  let status;
  if (!g.inRound) status = 'Du er med fra næste runde';
  else if (myTurn && g.pendingDraw) status = `Læg et +kort eller træk ${g.pendingDraw}`;
  else if (myTurn && g.hasDrawn) status = 'Læg det nye kort – eller pas';
  else if (myTurn && S.selected.length) status = 'Vælg flere ens – eller tryk igen for at lægge';
  else if (myTurn) status = g.playable.length ? 'Din tur!' : 'Din tur – træk et kort';
  else if (current) status = `${esc(genitive(current.name))} tur${currentOffline ? ' (offline)' : ''}`;
  else status = '';
  if (!myTurn && g.pendingDraw) status += ` · +${g.pendingDraw} venter`;

  const selecting = myTurn && S.selected.length > 0;
  const firstSelected = selecting ? g.hand.find((c) => c.id === S.selected[0]) : null;
  const hand = sortHand(g.hand)
    .map((c) => {
      const order = selecting ? S.selected.indexOf(c.id) + 1 : 0;
      let state = '';
      if (selecting) state = order ? 'selected' : c.value === firstSelected.value ? 'addable' : 'dim';
      else if (myTurn) state = g.playable.includes(c.id) ? 'playable' : 'dim';
      const cls = [state, c.id === g.drawnCardId ? 'drawn' : ''].join(' ');
      const hint =
        state === 'playable'
          ? ', kan lægges'
          : state === 'selected'
            ? ', valgt'
            : state === 'addable'
              ? ', kan lægges med'
              : '';
      return cardHTML(c, { cls, act: 'play', order, label: cardName(c) + hint });
    })
    .join('');

  const canDraw = myTurn && !g.hasDrawn && !selecting;
  const mustDraw = canDraw && (g.playable.length === 0 || g.pendingDraw > 0);
  // UNO kan også siges i egen tur, når de valgte ens kort efterlader ét kort.
  const landsOnOne = selecting && meInRound && meInRound.count - S.selected.length === 1;
  const showUno =
    g.inRound && g.phase === 'playing' && meInRound && !meInRound.saidUno && (meInRound.count <= 2 || landsOnOne);
  const iAmCaught = g.unoTarget === S.me;
  const caught = g.unoTarget && g.unoTarget !== S.me && g.inRound && g.phase === 'playing' ? roster[g.unoTarget] : null;

  return `${topBar(v)}
  <main class="game ${myTurn ? 'my-turn' : ''}">
    <section class="opponents" aria-label="Modspillere i turrækkefølge">${opponents}</section>
    <ol class="ticker ${S.flashLog ? 'flash' : ''}" aria-label="Seneste træk">${g.log
      .slice(-2)
      .reverse()
      .map((l) => `<li>${esc(l.text)}</li>`)
      .join('')}</ol>
    <section class="table">
      <div class="piles">
        <button class="pile ${canDraw ? 'can' : ''}" data-act="draw" ${canDraw ? '' : 'disabled'} aria-label="Træk kort (${g.drawCount} tilbage)">
          <span class="card back"><span class="oval"><span class="sym">UNO</span></span></span>
          <span class="pile-count">${g.drawCount}</span>
        </button>
        <div class="discard">
          ${g.under ? cardHTML(g.under, { cls: 'under-card', label: null }) : ''}
          ${cardHTML(g.top, { cls: 'top', label: `Øverst: ${cardName(g.top)}, farve ${colorName(g.currentColor)}` })}
        </div>
      </div>
      <div class="table-info">
        <span class="color-pill" style="--cur: var(--${g.currentColor})"><span class="dot"></span>${colorName(g.currentColor)}</span>
        <span class="dir-pill">${g.direction === 1 ? '↻ Med uret' : '↺ Mod uret'}</span>
      </div>
      ${caught ? `<button class="catch-banner" data-act="catch" data-id="${esc(caught.id)}">${esc(caught.name)} glemte UNO – <b>Fang!</b></button>` : ''}
    </section>
    <section class="dock">
      <div class="status ${myTurn ? 'mine' : ''}" role="status" aria-live="polite">${status}</div>
      <div class="actions">
        ${showUno ? `<button class="btn uno ${iAmCaught || meInRound.count === 1 ? 'urgent' : ''}" data-act="uno">UNO!</button>` : ''}
        ${
          selecting
            ? `<button class="btn primary" data-act="play-selected">Læg ${S.selected.length} kort</button>
               <button class="btn ghost" data-act="cancel-select">Fortryd</button>`
            : ''
        }
        ${myTurn && g.hasDrawn ? '<button class="btn" data-act="pass">Pas</button>' : ''}
        ${canDraw ? `<button class="btn ${mustDraw ? 'primary' : ''}" data-act="draw">Træk${g.pendingDraw ? ` ${g.pendingDraw}` : ''}</button>` : ''}
      </div>
      <section class="hand ${g.hand.length > 9 ? 'tight' : ''}" aria-label="Dine kort">${hand || (g.inRound ? '' : '<p class="muted">Du er med fra næste runde</p>')}</section>
    </section>
  </main>
  ${S.picking !== null ? renderPicker() : ''}
  ${g.phase === 'roundOver' ? renderRoundOver(v) : ''}`;
}

function renderPicker() {
  return `<div class="overlay" data-act="cancel-pick">
    <div class="sheet" data-stop>
      <h2>Vælg en farve</h2>
      <div class="colors">
        ${COLORS.map((c) => `<button class="swatch c-${c}" data-act="pick" data-color="${c}">${colorName(c)}</button>`).join('')}
      </div>
      <button class="btn ghost" data-act="cancel-pick">Fortryd</button>
    </div>
  </div>`;
}

function renderRoundOver(v) {
  const g = v.game;
  const isHost = v.hostId === S.me;
  const target = v.settings.target ?? 500;
  const winner = v.roster.find((p) => p.id === g.winnerId) ?? g.players.find((p) => p.id === g.winnerId);
  const rows = [...v.roster].sort((a, b) => b.score - a.score);
  // Vinderen af hele spillet kommer fra værten (også hvis hun har forladt spillet bagefter).
  const champion = v.champion !== undefined ? v.champion : rows.find((p) => p.score >= target);
  const left = Object.fromEntries(g.players.map((p) => [p.id, p.hand ?? []]));

  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <div class="sheet result">
      <div class="winner">
        ${winner ? avatar(winner, 'xl') : ''}
        <div>
          <h2 id="result-title">${winner ? `${esc(winner.name)} vandt runden!` : 'Runden er slut'}</h2>
          <p class="gain">+${g.points} point</p>
        </div>
      </div>
      ${champion ? `<p class="champion">🏆 ${esc(champion.name)} har nået ${target} point og vinder hele spillet!</p>` : ''}
      <table class="scores">
        <thead><tr><th>Spiller</th><th>Kort tilbage</th><th class="num">Runde</th><th class="num">I alt</th></tr></thead>
        <tbody>
        ${rows
          .map((p) => {
            const cards = left[p.id] ?? [];
            return `<tr class="${p.id === g.winnerId ? 'win' : ''}">
              <td><span class="who">${avatar(p, 'sm')}<span>${esc(p.name)}</span></span></td>
              <td class="left" aria-label="${cards.length} kort">${cards.map((c) => cardHTML(c, { cls: 'micro', label: null })).join('')}</td>
              <td class="num">${p.id === g.winnerId ? `+${g.points}` : '–'}</td>
              <td class="num total">${p.score}</td>
            </tr>`;
          })
          .join('')}
        </tbody>
      </table>
      <p class="muted small">Først til ${target} point vinder</p>
      ${
        isHost
          ? champion
            ? '<button class="btn primary big" data-act="new-game">Nyt spil (nulstil point)</button>'
            : '<button class="btn primary big" data-act="start">Næste runde</button>'
          : '<p class="waiting">Venter på at værten starter næste runde…</p>'
      }
    </div>
  </div>`;
}

function renderInvite(v) {
  return `<div class="overlay" data-act="close-invite">
    <div class="sheet invite-sheet" data-stop role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <h2 id="invite-title">Inviter flere</h2>
      ${qrSVG(shareLink(v.code))}
      <p class="muted">Scan med kameraet, eller skriv koden på forsiden</p>
      <div class="big-code">${esc(v.code)}</div>
      ${v.game ? '<p class="hint">Nye spillere kommer med, når den næste runde starter.</p>' : ''}
      <button class="btn primary" data-act="share">Del link</button>
      <button class="btn ghost" data-act="close-invite">Luk</button>
    </div>
  </div>`;
}

function renderRules() {
  return `<div class="overlay" data-act="close-rules">
    <div class="sheet rules" data-stop>
      <h2>Sådan spiller I</h2>
      <ol>
        <li><b>Én opretter spillet</b> og får en kode på 4 bogstaver. De andre åbner siden på deres egen telefon, skriver deres navn og koden. 2–${MAX_PLAYERS} spillere.</li>
        <li>Alle får 7 kort. Læg et kort, der har <b>samme farve, tal eller symbol</b> som kortet i midten. Kort, der kan lægges, lyser op.</li>
        <li>Kan du ikke lægge noget, så <b>tryk på bunken</b> for at trække et kort. Passer det, må du lægge det – ellers går turen videre.</li>
        <li><b>⊘ Spring over</b>: næste spiller mister sin tur. <b>⇄ Retningsskift</b>: turen går den anden vej. <b>+2</b>: næste spiller trækker 2 og mister turen.</li>
        <li><b>Flere ens:</b> Har du fx tre 8'ere, og passer den første, må du lægge alle tre på én gang – uanset farve. Tryk på det første kort, tryk på de andre, og tryk <b>Læg</b>. Det sidste kort bestemmer farven. To +2 giver 4 kort, to spring over springer to over.</li>
        <li><b>Farveskift</b>: vælg ny farve. <b>+4</b>: vælg farve, og næste spiller trækker 4 og mister turen.</li>
        <li>Når du lægger dit næstsidste kort, skal du trykke <b>UNO!</b> Glemmer du det, kan de andre trykke <b>Fang!</b> – så trækker du 2 kort.</li>
        <li>Den første uden kort vinder runden og får point for de andres kort (tal = værdien, action-kort = 20, sorte = 50). Den første, der når pointmålet, vinder – værten vælger 100, 200, 300 eller 500 (officielt).</li>
      </ol>
      <p class="muted small">Tip: Hold skærmen tændt under spillet. Mister nogen forbindelsen, kommer de automatisk tilbage, når de åbner siden igen.</p>
      <button class="btn primary" data-act="close-rules">Forstået</button>
    </div>
  </div>`;
}

// ---------- Input ----------

function readName() {
  const name = cleanName(document.getElementById('name')?.value ?? S.name);
  if (!name) {
    toast('Skriv dit navn først', 'error');
    document.getElementById('name')?.focus();
    return false;
  }
  S.name = name;
  save(KEYS.name, name);
  return true;
}

async function share() {
  const url = shareLink(S.view.code);
  const text = `Kom og spil UNO med os! Koden er ${S.view.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: 'Unoisk', text, url });
    await navigator.clipboard.writeText(url);
    toast('Link kopieret – send det til de andre');
  } catch {
    // Brugeren lukkede delingsdialogen.
  }
}

const actions = {
  avatar(el) {
    // Tryk igen på den valgte for at fravælge (så vises forbogstavet).
    S.avatar = S.avatar === el.dataset.emoji ? null : el.dataset.emoji;
    save(KEYS.avatar, S.avatar);
    for (const b of app.querySelectorAll('.avatar-pick button')) {
      const on = b.dataset.emoji === S.avatar;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  },
  create() {
    if (!readName()) return;
    const session = load(KEYS.session);
    if (
      session &&
      !confirm(`Du har et spil i gang (${session.code}). Vil du starte et nyt? Det gamle spil forsvinder.`)
    )
      return;
    save(KEYS.host, null);
    startHost(makeCode());
  },
  join() {
    if (!readName()) return;
    const code = normalizeCode(document.getElementById('code')?.value);
    if (code.length !== 4) return toast('Koden er 4 bogstaver', 'error');
    const session = load(KEYS.session);
    if (
      session?.role === 'host' &&
      session.code !== code &&
      !confirm(`Du er vært for spillet ${session.code}. Deltager du i et andet spil, forsvinder dit eget. Fortsæt?`)
    )
      return;
    if (session?.role === 'host' && session.code !== code) save(KEYS.host, null);
    S.notice = '';
    startClient(code);
  },
  resume() {
    const session = load(KEYS.session);
    if (!session || !readName()) return;
    if (session.role === 'client') return startClient(session.code, true);
    const saved = load(KEYS.host);
    if (!saved) {
      save(KEYS.session, null);
      S.notice = 'Det gemte spil kunne ikke findes på denne telefon. Opret et nyt spil.';
      return render();
    }
    startHost(session.code, saved);
  },
  leave() {
    const isHost = S.role === 'host';
    if (S.screen === 'play' && !confirm(isHost ? 'Afslut spillet for alle?' : 'Vil du forlade spillet?')) return;
    leaveGame();
  },
  share,
  invite() {
    S.showInvite = true;
    render();
  },
  'close-invite'() {
    S.showInvite = false;
    render();
  },
  async install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    updateInstallSlot();
  },
  rules() {
    S.showRules = true;
    render();
  },
  'close-rules'() {
    S.showRules = false;
    render();
  },
  start() {
    send({ type: 'start' });
  },
  'new-game'() {
    send({ type: 'start', resetScores: true });
  },
  kick(el) {
    const p = S.view.roster.find((r) => r.id === el.dataset.id);
    if (p && (p.bot || confirm(`Fjern ${p.name} fra spillet?`))) send({ type: 'kick', targetId: p.id });
  },
  target(el) {
    send({ type: 'settings', settings: { target: Number(el.dataset.target) } });
  },
  'add-bot'() {
    send({ type: 'addBot' });
  },
  play(el) {
    const g = S.view.game;
    const id = Number(el.dataset.id);
    if (g.currentId !== S.me) return toast('Vent på din tur');
    const card = g.hand.find((c) => c.id === id);

    if (S.selected.length) {
      const first = g.hand.find((c) => c.id === S.selected[0]);
      if (id === first.id) {
        // Tryk igen på kortet = læg. Et hurtigt dobbelttryk (under 300 ms) tæller ikke.
        if (Date.now() - S.selectedAt < 300) return;
        return actions['play-selected']();
      } else if (S.selected.includes(id)) S.selected = S.selected.filter((x) => x !== id);
      else if (card.value === first.value) S.selected.push(id);
      else toast('Vælg kort med samme tal eller symbol');
      return render();
    }

    if (!g.playable.includes(id)) return toast('Det kort passer ikke', 'error');
    const twins =
      g.settings.multiPlay && !g.hasDrawn && card.color !== null
        ? g.hand.filter((c) => c.id !== id && c.value === card.value)
        : [];
    if (twins.length) {
      // Der er flere ens på hånden – lad spilleren vælge, hvor mange der skal lægges.
      S.selected = [id];
      S.selectedAt = Date.now();
      render();
    } else if (card.color === null) {
      S.picking = id;
      render();
    } else {
      send({ type: 'play', cardId: id });
    }
  },
  pick(el) {
    const cardId = S.picking;
    S.picking = null;
    send({ type: 'play', cardId, color: el.dataset.color });
  },
  'play-selected'() {
    const cardIds = S.selected;
    S.selected = [];
    send({ type: 'play', cardIds });
  },
  'cancel-select'() {
    S.selected = [];
    render();
  },
  'cancel-pick'() {
    S.picking = null;
    render();
  },
  draw() {
    send({ type: 'draw' });
  },
  pass() {
    send({ type: 'pass' });
  },
  uno() {
    send({ type: 'uno' });
  },
  catch(el) {
    send({ type: 'catch', targetId: el.dataset.id });
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act], [data-stop]');
  if (!el || !el.dataset.act) return; // klik inde i et ark lukker det ikke
  actions[el.dataset.act]?.(el);
});

app.addEventListener('change', (e) => {
  const key = e.target.dataset?.setting;
  if (key) send({ type: 'settings', settings: { [key]: e.target.checked } });
});

app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') actions.join();
  // Enter i navnefeltet må aldrig oprette et spil ved et uheld – gå videre til koden i stedet.
  if (e.target.id === 'name') {
    if (normalizeCode(document.getElementById('code')?.value).length === 4) actions.join();
    else document.getElementById('code')?.focus();
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'code') {
    e.target.value = normalizeCode(e.target.value);
    // Har man skrevet en kode, er "Deltag" det oplagte næste skridt.
    const hasCode = e.target.value.length > 0;
    app.querySelector('[data-act=join]')?.classList.toggle('primary', hasCode);
    app.querySelector('[data-act=create]')?.classList.toggle('primary', !hasCode && !load(KEYS.session));
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.role) return;
  keepAwake();
  if (S.role === 'client' && !S.conn) {
    clearTimeout(S.retry);
    startClient(S.code, true);
  }
});

// ---------- Installation som app ----------

let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isAndroid = /Android/i.test(navigator.userAgent);

function installHTML() {
  if (isInstalled()) return '';
  if (installPrompt) return '<button class="btn install big" data-act="install">📲 Installér som app</button>';
  if (isAndroid)
    return '<p class="install-hint">Installér som app: tryk på <b>⋮</b> i Chrome og vælg <b>Installer app</b></p>';
  return '';
}

function updateInstallSlot() {
  const slot = document.getElementById('install-slot');
  if (slot) slot.innerHTML = installHTML();
}

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  updateInstallSlot();
});

addEventListener('appinstalled', () => {
  installPrompt = null;
  updateInstallSlot();
  toast('Unoisk er installeret 🎉');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Start ----------

const session = load(KEYS.session);
const linkCode = normalizeCode(params.get('rum'));
if (session && S.name && (!linkCode || linkCode === session.code)) {
  actions.resume(); // samme tjek som "Fortsæt": intet tomt spil, hvis de gemte data mangler
} else {
  render();
  document.getElementById(S.name && linkCode ? 'code' : 'name')?.focus();
}
