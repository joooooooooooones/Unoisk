import { createTransport, makeCode, normalizeCode } from './net.js';
import { Host, cleanName } from './host.js';
import { COLORS, colorName, MAX_PLAYERS } from './game.js';

const params = new URLSearchParams(location.search);
const isLocal = params.has('lokal');
// I testtilstand deler fanerne ikke identitet, så hver fane er sin egen spiller.
const storage = isLocal ? sessionStorage : localStorage;
const KEYS = { id: 'unoisk.id', name: 'unoisk.name', session: 'unoisk.session', host: 'unoisk.host' };

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
  selected: [], // kort valgt til at blive lagt sammen (samme tal/symbol)
  showRules: false,
  lastLogId: 0,
  flashLog: false,
  lastRound: 0,
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
    me: { id: S.me, name: S.name },
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
      conn.send({ t: 'join', id: S.me, name: S.name });
    },
    onError: (err) => {
      if (S.role !== 'client') return;
      if (err === 'not-found' && !resuming && !S.view) {
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

function send(action) {
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
  Object.assign(S, { link: null, view: null, screen: 'home', notice, picking: null, lastRound: 0, lastLogId: 0 });
  releaseWakeLock();
  render();
}

// ---------- Tilstand ----------

function setView(view) {
  const first = !S.view;
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
  render();
}

// ---------- Hjælpere ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function hue(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const avatar = (p) => `<span class="avatar" style="--hue:${hue(p.id)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>`;
const genitive = (name) => (/[sxz]$/i.test(name) ? `${name}'` : `${name}s`);

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

function cardHTML(card, { cls = '', act = '', order = 0 } = {}) {
  const sym = SYMBOLS[card.value] ?? card.value;
  const color = card.color ? `c-${card.color}` : 'c-wild';
  const under = card.value === '6' || card.value === '9' ? ' under' : '';
  const tag = act ? 'button' : 'div';
  let attrs = act ? ` data-act="${act}" data-id="${card.id}" type="button"` : '';
  if (order) attrs += ` data-order="${order}"`;
  return `<${tag} class="card ${color} v-${card.value} ${cls}"${attrs}>
    <span class="corner tl${under}">${sym}</span>
    <span class="oval"><span class="sym${under}">${sym}</span></span>
    <span class="corner br${under}">${sym}</span>
  </${tag}>`;
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

function render() {
  const handEl = app.querySelector('.hand');
  const scroll = handEl?.scrollLeft ?? 0;

  let html;
  if (S.screen === 'home') html = renderHome();
  else if (S.screen === 'connecting' || !S.view) html = renderConnecting();
  else if (S.view.game) html = renderGame(S.view);
  else html = renderLobby(S.view);

  if (S.screen === 'play' && !S.online) {
    html += `<div class="banner">Forbindelsen er tabt – prøver igen…</div>`;
  }
  if (S.showRules) html += renderRules();
  app.innerHTML = html;
  S.flashLog = false;

  const newHand = app.querySelector('.hand');
  if (newHand) newHand.scrollLeft = scroll;
}

function renderHome() {
  const session = load(KEYS.session);
  const code = normalizeCode(params.get('rum'));
  return `<main class="home">
    <h1 class="logo">UNO<span>isk</span></h1>
    <p class="tagline">UNO for hele familien – hver på sin telefon</p>
    ${S.notice ? `<p class="notice">${esc(S.notice)}</p>` : ''}
    <label class="field">Dit navn
      <input id="name" maxlength="16" value="${esc(S.name)}" placeholder="Fx Mormor" autocomplete="nickname" enterkeyhint="done">
    </label>
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
    <button class="code-chip" data-act="share" title="Del link">Kode <b>${esc(v.code)}</b></button>
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
      <div class="label">Bed de andre om at åbne siden og skrive koden</div>
      <div class="big-code">${esc(v.code)}</div>
      <button class="btn small" data-act="share">Del link</button>
    </section>
    <section class="panel">
      <h2>Spillere <span class="muted">${v.roster.length}/${MAX_PLAYERS}</span></h2>
      <ul class="roster">
        ${v.roster
          .map(
            (p) => `<li class="${p.connected ? '' : 'offline'}">
            ${avatar(p)}
            <span class="pname">${esc(p.name)}${p.id === v.hostId ? ' 👑' : ''}${p.id === S.me ? ' <span class="muted">(dig)</span>' : ''}</span>
            ${p.connected ? '' : '<span class="muted">offline</span>'}
            ${isHost && p.id !== S.me ? `<button class="x" data-act="kick" data-id="${esc(p.id)}" aria-label="Fjern ${esc(p.name)}">✕</button>` : ''}
          </li>`,
          )
          .join('')}
      </ul>
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
    .map((p) => {
      const connected = roster[p.id]?.connected ?? false;
      const catchable = g.unoTarget === p.id && g.inRound && g.phase === 'playing';
      return `<div class="opp ${p.id === g.currentId ? 'turn' : ''} ${connected ? '' : 'offline'}">
        ${avatar(p)}
        <div class="oname">${esc(p.name)}</div>
        <div class="ocount"><span class="mini-back"></span>${p.count}</div>
        ${p.count === 1 && p.saidUno ? '<span class="badge">UNO</span>' : ''}
        ${catchable ? `<button class="btn catch" data-act="catch" data-id="${esc(p.id)}">Fang!</button>` : ''}
        ${isHost && !connected ? `<button class="btn tiny" data-act="kick" data-id="${esc(p.id)}">Fjern</button>` : ''}
      </div>`;
    })
    .join('');

  let status;
  if (!g.inRound) status = 'Du er med fra næste runde';
  else if (myTurn && g.pendingDraw) status = `Læg et +kort eller træk ${g.pendingDraw}`;
  else if (myTurn && g.hasDrawn) status = 'Læg det nye kort – eller pas';
  else if (myTurn && S.selected.length) status = 'Vælg flere ens – tryk så Læg';
  else if (myTurn) status = g.playable.length ? 'Din tur!' : 'Din tur – træk et kort';
  else status = current ? `${esc(genitive(current.name))} tur` : '';
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
      return cardHTML(c, { cls, act: 'play', order });
    })
    .join('');

  const canDraw = myTurn && !g.hasDrawn && !selecting;
  const showUno = g.inRound && g.phase === 'playing' && meInRound && meInRound.count <= 2 && !meInRound.saidUno;
  const iAmCaught = g.unoTarget === S.me;

  return `${topBar(v)}
  <main class="game ${myTurn ? 'my-turn' : ''}">
    <section class="opponents">${opponents}</section>
    <ol class="ticker ${S.flashLog ? 'flash' : ''}">${g.log
      .slice(-2)
      .reverse()
      .map((l) => `<li>${esc(l.text)}</li>`)
      .join('')}</ol>
    <section class="table">
      <button class="pile ${canDraw ? 'can' : ''}" data-act="draw" ${canDraw ? '' : 'disabled'} aria-label="Træk kort">
        <span class="card back"><span class="oval"><span class="sym">UNO</span></span></span>
        <span class="pile-count">${g.drawCount}</span>
      </button>
      <div class="discard" style="--cur: var(--${g.currentColor})">
        ${cardHTML(g.top, { cls: 'top' })}
        <span class="color-dot" title="Farve: ${colorName(g.currentColor)}"></span>
      </div>
      <div class="dir ${g.direction === 1 ? 'cw' : 'ccw'}" title="Retning">${g.direction === 1 ? '↻' : '↺'}</div>
    </section>
    <div class="status ${myTurn ? 'mine' : ''}">${status}</div>
    <div class="actions">
      ${showUno ? `<button class="btn uno ${iAmCaught || meInRound.count === 1 ? 'urgent' : ''}" data-act="uno">UNO!</button>` : ''}
      ${
        selecting
          ? `<button class="btn primary" data-act="play-selected">Læg ${S.selected.length} kort</button>
             <button class="btn ghost" data-act="cancel-select">Fortryd</button>`
          : ''
      }
      ${myTurn && g.hasDrawn ? '<button class="btn" data-act="pass">Pas</button>' : ''}
      ${canDraw ? `<button class="btn" data-act="draw">Træk${g.pendingDraw ? ` ${g.pendingDraw}` : ''}</button>` : ''}
    </div>
    <section class="hand ${g.hand.length > 9 ? 'tight' : ''}">${hand || (g.inRound ? '' : '<p class="muted">Du er med fra næste runde</p>')}</section>
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
  const winner = g.players.find((p) => p.id === g.winnerId) ?? v.roster.find((p) => p.id === g.winnerId);
  const rows = [...v.roster].sort((a, b) => b.score - a.score);
  const champion = rows.find((p) => p.score >= 500);
  const left = Object.fromEntries(g.players.map((p) => [p.id, p.hand ?? []]));

  return `<div class="overlay">
    <div class="sheet result">
      <div class="confetti">🎉</div>
      <h2>${winner ? `${esc(winner.name)} vandt runden!` : 'Runden er slut'}</h2>
      <p class="muted">+${g.points} point</p>
      ${champion ? `<p class="champion">🏆 ${esc(champion.name)} har over 500 point og vinder hele spillet!</p>` : ''}
      <table class="scores">
        <tr><th></th><th>Kort tilbage</th><th>Point</th></tr>
        ${rows
          .map(
            (p) => `<tr class="${p.id === g.winnerId ? 'win' : ''}">
              <td>${avatar(p)} ${esc(p.name)}</td>
              <td class="left">${(left[p.id] ?? []).map((c) => cardHTML(c, { cls: 'micro' })).join('')}</td>
              <td class="pts">${p.score}</td>
            </tr>`,
          )
          .join('')}
      </table>
      <p class="muted small">Først til 500 point vinder</p>
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
        <li>Den første uden kort vinder runden og får point for de andres kort (tal = værdien, action-kort = 20, sorte = 50). Først til 500 vinder.</li>
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
  create() {
    if (readName()) startHost(makeCode());
  },
  join() {
    if (!readName()) return;
    const code = normalizeCode(document.getElementById('code')?.value);
    if (code.length !== 4) return toast('Koden er 4 bogstaver', 'error');
    S.notice = '';
    startClient(code);
  },
  resume() {
    const session = load(KEYS.session);
    if (!session || !readName()) return;
    if (session.role === 'host') startHost(session.code, load(KEYS.host));
    else startClient(session.code, true);
  },
  leave() {
    const isHost = S.role === 'host';
    if (S.screen === 'play' && !confirm(isHost ? 'Afslut spillet for alle?' : 'Vil du forlade spillet?')) return;
    leaveGame();
  },
  share,
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
    if (p && confirm(`Fjern ${p.name} fra spillet?`)) send({ type: 'kick', targetId: p.id });
  },
  play(el) {
    const g = S.view.game;
    const id = Number(el.dataset.id);
    if (g.currentId !== S.me) return toast('Vent på din tur');
    const card = g.hand.find((c) => c.id === id);

    if (S.selected.length) {
      const first = g.hand.find((c) => c.id === S.selected[0]);
      if (id === first.id) S.selected = [];
      else if (S.selected.includes(id)) S.selected = S.selected.filter((x) => x !== id);
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
  if (e.target.id === 'name')
    (normalizeCode(document.getElementById('code')?.value).length === 4 ? actions.join : actions.create)();
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'code') e.target.value = normalizeCode(e.target.value);
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
  if (session.role === 'host') startHost(session.code, load(KEYS.host));
  else startClient(session.code, true);
} else {
  render();
  document.getElementById(S.name && linkCode ? 'code' : 'name')?.focus();
}
