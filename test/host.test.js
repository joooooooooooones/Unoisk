import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Host } from '../js/host.js';

// En falsk forbindelse, der gemmer alt, hvad værten sender.
function fakeConn() {
  const handlers = { data: [], close: [] };
  const conn = {
    sent: [],
    closed: false,
    send: (msg) => conn.sent.push(structuredClone(msg)),
    onData: (fn) => handlers.data.push(fn),
    onClose: (fn) => handlers.close.push(fn),
    close: () => {
      if (conn.closed) return;
      conn.closed = true;
      handlers.close.forEach((fn) => fn());
    },
    receive: (msg) => handlers.data.forEach((fn) => fn(msg)),
    last: () => conn.sent.at(-1),
  };
  return conn;
}

function makeHost() {
  const views = [];
  const host = new Host({ code: 'ABCD', me: { id: 'h', name: 'Mor' }, onView: (v, msg) => views.push(v ?? msg) });
  return { host, views };
}

function join(host, id, name) {
  const conn = fakeConn();
  host.addConnection(conn);
  conn.receive({ t: 'join', id, name });
  return conn;
}

test('spillere kan joine, og værten kan starte med 6', () => {
  const { host, views } = makeHost();
  const conns = ['Far', 'Ida', 'Bo', 'Mormor', 'Morfar'].map((n, i) => join(host, `c${i}`, n));
  assert.equal(host.roster.length, 6);
  assert.equal(conns[0].last().view.roster.length, 6);

  conns[0].receive({ t: 'action', action: { type: 'start' } });
  assert.equal(conns[0].last().t, 'error', 'kun værten kan starte');

  host.act('h', { type: 'start' });
  const v = conns[2].last().view;
  assert.equal(v.game.players.length, 6);
  assert.equal(v.game.hand.length, 7);
  assert.equal(views.at(-1).game.hand.length, 7);
});

test('samme navn får et nummer', () => {
  const { host } = makeHost();
  join(host, 'c1', 'Mor');
  assert.deepEqual(
    host.roster.map((p) => p.name),
    ['Mor', 'Mor 2'],
  );
});

test('nye kan ikke joine midt i en runde, men gamle kan komme tilbage', () => {
  const { host } = makeHost();
  const far = join(host, 'c1', 'Far');
  host.act('h', { type: 'start' });

  const stranger = join(host, 'c9', 'Fremmed');
  assert.equal(stranger.sent[0].t, 'rejected');

  far.close();
  assert.equal(host.viewFor('h').roster[1].connected, false);
  const again = join(host, 'c1', 'Far');
  assert.equal(again.last().view.game.hand.length, 7);
  assert.equal(host.viewFor('h').roster[1].connected, true);
});

test('point lægges til, når en runde vindes', () => {
  const { host } = makeHost();
  join(host, 'c1', 'Far');
  host.act('h', { type: 'start' });
  const g = host.game;
  const me = g.players.find((p) => p.id === 'h');
  g.current = g.players.indexOf(me);
  me.hand = [{ id: 999, color: g.currentColor, value: '1' }];
  g.players.find((p) => p.id === 'c1').hand = [{ id: 998, color: null, value: 'wild' }];
  host.act('h', { type: 'play', cardId: 999 });
  assert.equal(host.game.phase, 'roundOver');
  assert.equal(host.scores.h, 50);
});

test('værten kan fjerne en spiller', () => {
  const { host } = makeHost();
  const far = join(host, 'c1', 'Far');
  join(host, 'c2', 'Ida');
  host.act('h', { type: 'kick', targetId: 'c1' });
  assert.equal(far.last().t, 'kicked');
  assert.deepEqual(
    host.roster.map((p) => p.id),
    ['h', 'c2'],
  );
});

// Falsk tidsplan: timere køres først, når testen beder om det.
function fakeClock() {
  let id = 0;
  const pending = new Map();
  return {
    schedule: (fn) => (pending.set(++id, fn), id),
    cancel: (t) => pending.delete(t),
    runAll() {
      const fns = [...pending.values()];
      pending.clear();
      fns.forEach((fn) => fn());
      return fns.length;
    },
  };
}

test('værten kan tilføje computerspillere, som spiller selv', () => {
  const clock = fakeClock();
  const views = [];
  const host = new Host({
    code: 'ABCD',
    me: { id: 'h', name: 'Mor' },
    onView: (v) => v && views.push(v),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  const far = join(host, 'c1', 'Far');
  far.receive({ t: 'action', action: { type: 'addBot' } });
  assert.equal(far.last().t, 'error', 'kun værten kan tilføje bots');

  host.act('h', { type: 'addBot' });
  host.act('h', { type: 'addBot' });
  const roster = host.viewFor('h').roster;
  assert.deepEqual(
    roster.map((p) => [p.name, p.bot, p.connected]),
    [
      ['Mor', false, true],
      ['Far', false, true],
      ['Robo-Rasmus', true, true],
      ['Bip-Bodil', true, true],
    ],
  );

  host.act('h', { type: 'start' });
  assert.throws(() => host.apply('h', { type: 'addBot' }), /runden er slut/);

  // Menneskerne trækker/passer bare; bottene skal selv drive spillet.
  let guard = 0;
  while (host.game.phase === 'playing' && guard++ < 3000) {
    const cur = host.game.players[host.game.current].id;
    if (cur === 'h' || cur === 'c1') host.act(cur, { type: host.game.hasDrawn ? 'pass' : 'draw' });
    else assert.ok(clock.runAll() > 0, 'en bot skal have en planlagt tur');
  }
  assert.equal(host.game.phase, 'roundOver');
  assert.ok(host.isBot(host.game.winnerId), 'bots vinder over spillere, der aldrig lægger');
  assert.ok(host.scores[host.game.winnerId] > 0);
});

test('en bot kan fjernes, og gemte værtsdata uden bot-felt kan stadig åbnes', () => {
  const { host } = makeHost();
  host.act('h', { type: 'addBot' });
  const botId = host.roster[1].id;
  host.act('h', { type: 'kick', targetId: botId });
  assert.equal(host.roster.length, 1);

  const old = {
    code: 'QWER',
    hostId: 'h',
    roster: [
      { id: 'h', name: 'Mor' },
      { id: 'x', name: 'Far' },
    ],
    scores: {},
    game: null,
    round: 0,
  };
  const restored = new Host({ code: 'QWER', me: { id: 'h', name: 'Mor' }, saved: old });
  assert.deepEqual(
    restored.viewFor('h').roster.map((p) => p.bot),
    [false, false],
  );
  assert.equal(restored.settings.multiPlay, true, 'manglende husregler får standardværdi');
});

test('point bevares, når en spiller fjernes og kommer tilbage', () => {
  const { host } = makeHost();
  join(host, 'c1', 'Far');
  host.scores.c1 = 120;
  host.act('h', { type: 'kick', targetId: 'c1' });
  join(host, 'c1', 'Far');
  assert.equal(host.viewFor('h').roster.find((p) => p.id === 'c1').score, 120);
});

function winRound(host, winnerId, loserCard) {
  const g = host.game;
  const w = g.players.find((p) => p.id === winnerId);
  g.current = g.players.indexOf(w);
  w.hand = [{ id: 9001, color: g.currentColor, value: '1' }];
  for (const p of g.players) if (p !== w) p.hand = [loserCard];
  host.act(winnerId, { type: 'play', cardId: 9001 });
}

test('pointmål: værten vælger målet, og spillet slutter når det nås', () => {
  const { host } = makeHost();
  const far = join(host, 'c1', 'Far');
  far.receive({ t: 'action', action: { type: 'settings', settings: { target: 100 } } });
  assert.equal(far.last().t, 'error', 'kun værten kan ændre mål');
  assert.throws(() => host.apply('h', { type: 'settings', settings: { target: 123 } }), /Ugyldigt/);
  host.act('h', { type: 'settings', settings: { target: 100 } });
  assert.equal(host.viewFor('c1').settings.target, 100);

  host.act('h', { type: 'start' });
  winRound(host, 'h', { id: 9002, color: null, value: 'wild' }); // +50
  assert.equal(host.championId, null);
  host.act('h', { type: 'start' });
  winRound(host, 'h', { id: 9003, color: null, value: 'wild4' }); // +50 → 100
  assert.equal(host.scores.h, 100);
  assert.equal(host.viewFor('c1').championId, 'h');
  assert.throws(() => host.apply('h', { type: 'start' }), /Spillet er slut/);

  host.act('h', { type: 'start', resetScores: true });
  assert.equal(host.championId, null);
  assert.deepEqual(host.scores, {});
  assert.equal(host.game.round, 1);
});

test('avatar: gyldige emoji gemmes, ugyldige ignoreres, gamle data uden avatar virker', () => {
  const host = new Host({ code: 'ABCD', me: { id: 'h', name: 'Mor', emoji: '🦊' } });
  const far = fakeConn();
  host.addConnection(far);
  far.receive({ t: 'join', id: 'c1', name: 'Far', emoji: '🐻' });
  const ida = fakeConn();
  host.addConnection(ida);
  ida.receive({ t: 'join', id: 'c2', name: 'Ida', emoji: '<img src=x>' });
  host.act('h', { type: 'addBot' });
  assert.deepEqual(
    host.viewFor('h').roster.map((p) => p.emoji),
    ['🦊', '🐻', null, '🤖'],
  );
  // Far skifter avatar ved genindtræden
  const again = fakeConn();
  host.addConnection(again);
  again.receive({ t: 'join', id: 'c1', name: 'Far', emoji: '🦁' });
  assert.equal(host.viewFor('h').roster[1].emoji, '🦁');

  const restored = new Host({
    code: 'ABCD',
    me: { id: 'h', name: 'Mor' },
    saved: JSON.parse(JSON.stringify(host.snapshot())),
  });
  assert.equal(restored.viewFor('h').roster[1].emoji, '🦁');
  assert.equal(restored.settings.target, 500);
});
