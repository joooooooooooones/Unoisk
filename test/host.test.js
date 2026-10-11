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
