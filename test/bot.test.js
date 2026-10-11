import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
import { chooseMoves, chooseCatch } from '../js/bot.js';

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 5000;
const c = (color, value) => ({ id: nextId++, color, value });
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}` }));

function setup(hands, top, settings = {}) {
  const s = G.newRound(players(hands.length), settings, { rng: seeded(1) });
  s.players.forEach((p, i) => (p.hand = hands[i]));
  s.discardPile = [top];
  s.currentColor = top.color;
  s.current = 0;
  return s;
}

const total = (s) => s.drawPile.length + s.discardPile.length + s.players.reduce((n, p) => n + p.hand.length, 0);

test('computerspillere kan spille hele runder til ende uden ulovlige træk', () => {
  for (const settings of [{}, { stacking: true }, { drawUntilPlayable: true }, { multiPlay: false }]) {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = seeded(seed);
      const s = G.newRound(players(6), settings, { rng, startIndex: seed });
      let turns = 0;
      while (s.phase === 'playing') {
        assert.ok(++turns < 3000, 'runden skal slutte');
        const id = G.currentPlayer(s).id;
        const moves = chooseMoves(G.viewFor(s, id), id, rng);
        assert.ok(moves.length > 0);
        for (const m of moves) G.applyAction(s, id, m); // kaster ved ulovligt træk
        const catcher = s.players.find((p) => chooseCatch(G.viewFor(s, p.id), p.id, rng));
        if (catcher) G.applyAction(s, catcher.id, { type: 'catch', targetId: s.unoTarget });
        assert.equal(total(s), 108);
      }
    }
  }
});

test('botten lægger alle ens og afslutter på sin bedste farve', () => {
  const s = setup(
    [[c('red', '8'), c('blue', '8'), c('green', '8'), c('green', '1'), c('green', '2')], [c('red', '1')]],
    c('red', '5'),
  );
  const [move] = chooseMoves(G.viewFor(s, 'b0'), 'b0', () => 0.5);
  assert.equal(move.type, 'play');
  assert.equal(move.cardIds.length, 3);
  const last = s.players[0].hand.find((x) => x.id === move.cardIds.at(-1));
  assert.equal(last.color, 'green');
});

test('botten gemmer sorte kort og vælger den farve, den har flest af', () => {
  let s = setup([[c(null, 'wild'), c('red', '3'), c('blue', '4')], [c('red', '1')]], c('red', '5'));
  assert.deepEqual(chooseMoves(G.viewFor(s, 'b0'), 'b0', () => 0.5)[0].cardIds.length, 1);
  assert.notEqual(chooseMoves(G.viewFor(s, 'b0'), 'b0', () => 0.5)[0].cardIds[0], s.players[0].hand[0].id);

  s = setup([[c(null, 'wild'), c('blue', '3'), c('blue', '4'), c('green', '1')], [c('red', '1')]], c('red', '5'));
  const [move] = chooseMoves(G.viewFor(s, 'b0'), 'b0', () => 0.5);
  assert.equal(move.color, 'blue');
});

test('botten trækker eller passer, når den ikke kan lægge', () => {
  const s = setup([[c('blue', '3')], [c('red', '1')]], c('red', '5'));
  s.drawPile.push(c('green', '9'), c('red', '9'));
  assert.deepEqual(chooseMoves(G.viewFor(s, 'b0'), 'b0'), [{ type: 'draw' }]);
  G.applyAction(s, 'b0', { type: 'draw' }); // trækker rød 9 – kan lægges
  const moves = chooseMoves(G.viewFor(s, 'b0'), 'b0', () => 0.5);
  assert.deepEqual(moves.at(-1), { type: 'play', cardIds: [s.drawnCardId] });
});

test('botten siger UNO, når den lander på ét kort', () => {
  const s = setup(
    [
      [c('red', '3'), c('red', '4')],
      [c('red', '1'), c('red', '2')],
    ],
    c('red', '5'),
  );
  const moves = chooseMoves(G.viewFor(s, 'b0'), 'b0', () => 0.1);
  assert.equal(moves[0].type, 'uno');
  for (const m of moves) G.applyAction(s, 'b0', m);
  assert.equal(s.unoTarget, null);
});
