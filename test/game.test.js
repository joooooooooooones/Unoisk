import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const names = ['Mor', 'Far', 'Ida', 'Bo', 'Mormor', 'Morfar'];
const players = (n) => names.slice(0, n).map((name, i) => ({ id: `p${i}`, name }));

let nextId = 1000;
const c = (color, value) => ({ id: nextId++, color, value });

// Byg en runde med bestemte hænder og et bestemt kort i midten.
function setup(hands, top, settings = {}) {
  const state = G.newRound(players(hands.length), settings, { rng: seeded(1) });
  state.players.forEach((p, i) => (p.hand = hands[i]));
  state.discardPile = [top];
  state.currentColor = top.color;
  state.drawPile = Array.from({ length: 20 }, () => c('green', '7'));
  state.current = 0;
  return state;
}

const totalCards = (s) => s.drawPile.length + s.discardPile.length + s.players.reduce((n, p) => n + p.hand.length, 0);

test('kortbunken har 108 UNO-kort', () => {
  const deck = G.createDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((d) => d.id)).size, 108);
  assert.equal(deck.filter((d) => d.value === 'wild').length, 4);
  assert.equal(deck.filter((d) => d.value === 'wild4').length, 4);
  assert.equal(deck.filter((d) => d.value === '0').length, 4);
  assert.equal(deck.filter((d) => d.color === 'red' && d.value === '7').length, 2);
  assert.equal(deck.filter((d) => d.value === 'draw2').length, 8);
});

test('ny runde med 6 spillere giver 7 kort hver og starter med et talkort', () => {
  const s = G.newRound(players(6), {}, { rng: seeded(42) });
  for (const p of s.players) assert.equal(p.hand.length, 7);
  assert.ok(G.isNumber(G.topCard(s)));
  assert.equal(totalCards(s), 108);
});

test('man skal matche farve eller tal og vente på sin tur', () => {
  const s = setup([[c('red', '3'), c('blue', '5'), c('green', '1')], [c('red', '9')]], c('red', '5'));
  assert.throws(() => G.applyAction(s, 'p1', { type: 'play', cardId: s.players[1].hand[0].id }), /ikke din tur/);
  assert.throws(() => G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[2].id }), /kan ikke lægges/);
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[1].id }); // blå 5 på rød 5
  assert.equal(s.currentColor, 'blue');
  assert.equal(s.current, 1);
});

test('spring over, retningsskift og +2', () => {
  const hand = () => [c('red', '1'), c('red', '2'), c('red', '3')];
  let s = setup([[c('red', 'skip'), ...hand()], hand(), hand(), hand()], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.current, 2);

  s = setup([[c('red', 'reverse'), ...hand()], hand(), hand(), hand()], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.direction, -1);
  assert.equal(s.current, 3);

  s = setup([[c('red', 'reverse'), ...hand()], hand()], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.current, 0, 'med 2 spillere virker retningsskift som spring over');

  s = setup([[c('red', 'draw2'), ...hand()], hand(), hand()], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.players[1].hand.length, 5);
  assert.equal(s.current, 2);
});

test('farveskift kræver en farve, og +4 giver næste spiller 4 kort', () => {
  const s = setup([[c(null, 'wild4'), c('red', '1')], [c('red', '1')], [c('red', '1')]], c('blue', '5'));
  const id = s.players[0].hand[0].id;
  assert.throws(() => G.applyAction(s, 'p0', { type: 'play', cardId: id }), /Vælg en farve/);
  G.applyAction(s, 'p0', { type: 'play', cardId: id, color: 'yellow' });
  assert.equal(s.currentColor, 'yellow');
  assert.equal(s.players[1].hand.length, 5);
  assert.equal(s.current, 2);
});

test('trækker man et kort, der ikke passer, går turen videre', () => {
  const s = setup([[c('blue', '1')], [c('red', '1')]], c('red', '5'));
  s.drawPile.push(c('yellow', '9'));
  G.applyAction(s, 'p0', { type: 'draw' });
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.current, 1);
});

test('trækker man et kort, der passer, må man kun lægge det eller passe', () => {
  const s = setup([[c('red', '1'), c('blue', '1')], [c('red', '1')]], c('green', '5'));
  const drawn = c('green', '9');
  s.drawPile.push(drawn);
  G.applyAction(s, 'p0', { type: 'draw' });
  assert.equal(s.current, 0);
  assert.equal(s.hasDrawn, true);
  assert.throws(() => G.applyAction(s, 'p0', { type: 'draw' }), /allerede trukket/);
  assert.deepEqual(G.viewFor(s, 'p0').playable, [drawn.id]);
  G.applyAction(s, 'p0', { type: 'pass' });
  assert.equal(s.current, 1);
});

test('glemmer man UNO, kan man blive fanget', () => {
  const s = setup(
    [
      [c('red', '1'), c('red', '2')],
      [c('blue', '1'), c('blue', '2')],
    ],
    c('red', '5'),
  );
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.unoTarget, 'p0');
  G.applyAction(s, 'p1', { type: 'catch', targetId: 'p0' });
  assert.equal(s.players[0].hand.length, 3);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'catch', targetId: 'p0' }), /For sent/);
});

test('siger man UNO i tide, kan man ikke fanges', () => {
  const s = setup(
    [
      [c('red', '1'), c('red', '2')],
      [c('blue', '1'), c('blue', '2')],
    ],
    c('red', '5'),
  );
  G.applyAction(s, 'p0', { type: 'uno' });
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.unoTarget, null);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'catch', targetId: 'p0' }), /For sent/);
});

test('UNO kan også siges lige efter, før nogen fanger én', () => {
  const s = setup(
    [
      [c('red', '1'), c('red', '2')],
      [c('blue', '1'), c('blue', '2')],
    ],
    c('red', '5'),
  );
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  G.applyAction(s, 'p0', { type: 'uno' });
  assert.equal(s.unoTarget, null);
});

test('chancen for at fange forsvinder, når næste spiller handler', () => {
  const s = setup([[c('red', '1'), c('red', '2')], [c('red', '3'), c('blue', '2')], [c('red', '4')]], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  G.applyAction(s, 'p1', { type: 'play', cardId: s.players[1].hand[0].id });
  assert.equal(s.unoTarget, 'p1');
  assert.throws(() => G.applyAction(s, 'p2', { type: 'catch', targetId: 'p0' }), /For sent/);
});

test('sidste kort vinder runden og giver point for de andres kort', () => {
  const s = setup([[c('red', '1')], [c('blue', '7'), c(null, 'wild')], [c('green', 'skip')]], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.winnerId, 'p0');
  assert.equal(s.points, 7 + 50 + 20);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'draw' }), /Runden er slut/);
});

test('stabling af +2 og +4', () => {
  const s = setup(
    [
      [c('red', 'draw2'), c('red', '1')],
      [c('blue', 'draw2'), c('blue', '1')],
      [c(null, 'wild4'), c('red', '1')],
      [c('red', '1')],
    ],
    c('red', '5'),
    { stacking: true },
  );
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.pendingDraw, 2);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'play', cardId: s.players[1].hand[1].id }), /kan ikke lægges/);
  G.applyAction(s, 'p1', { type: 'play', cardId: s.players[1].hand[0].id });
  G.applyAction(s, 'p2', { type: 'play', cardId: s.players[2].hand[0].id, color: 'green' });
  assert.equal(s.pendingDraw, 8);
  G.applyAction(s, 'p3', { type: 'draw' });
  assert.equal(s.players[3].hand.length, 9);
  assert.equal(s.pendingDraw, 0);
  assert.equal(s.current, 0);
});

test('en spiller kan fjernes midt i runden', () => {
  const s = setup([[c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '5'));
  s.current = 1; // turen er hos Far (p1)
  G.removePlayer(s, 'p1');
  assert.equal(s.players.length, 2);
  assert.equal(s.players[s.current].id, 'p2');
  G.removePlayer(s, 'p2');
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.winnerId, 'p0');
});

test('viewFor viser kun ens egne kort', () => {
  const s = G.newRound(players(6), {}, { rng: seeded(3) });
  const v = G.viewFor(s, 'p2');
  assert.equal(v.hand.length, 7);
  assert.ok(v.players.every((p) => p.hand === undefined && p.count === 7));
  assert.equal(JSON.stringify(v).includes(JSON.stringify(s.players[0].hand[0])), false);
});

// Spil mange tilfældige 6-mandsspil til ende og tjek, at intet kort forsvinder.
test('tilfældige spil med 6 spillere går op', () => {
  for (const settings of [{}, { stacking: true }, { drawUntilPlayable: true }]) {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seeded(seed);
      const s = G.newRound(players(6), settings, { rng, startIndex: seed });
      let turns = 0;
      while (s.phase === 'playing') {
        assert.ok(++turns < 5000, 'spillet bør slutte');
        const p = G.currentPlayer(s);
        if (rng() < 0.05 && s.unoTarget) {
          const catcher = s.players.find((q) => q.id !== s.unoTarget);
          G.applyAction(s, catcher.id, { type: 'catch', targetId: s.unoTarget });
        }
        if (p.hand.length === 2 && rng() < 0.7) G.applyAction(s, p.id, { type: 'uno' });
        const playable = p.hand.filter((card) => G.canPlay(s, card));
        if (playable.length) {
          const card = playable[Math.floor(rng() * playable.length)];
          const same =
            G.isWild(card) || s.hasDrawn ? [] : p.hand.filter((o) => o.id !== card.id && o.value === card.value);
          const extra = same.slice(0, Math.floor(rng() * (same.length + 1)));
          const cardIds = [card.id, ...extra.map((o) => o.id)];
          G.applyAction(s, p.id, { type: 'play', cardIds, color: G.COLORS[Math.floor(rng() * 4)] });
        } else if (s.hasDrawn) {
          G.applyAction(s, p.id, { type: 'pass' });
        } else {
          G.applyAction(s, p.id, { type: 'draw' });
        }
        assert.equal(totalCards(s), 108);
      }
      assert.equal(s.players.find((p) => p.id === s.winnerId).hand.length, 0);
    }
  }
});

test('flere ens kort kan lægges på én gang uanset farve', () => {
  const eights = [c('blue', '8'), c('green', '8'), c('yellow', '8')];
  const s = setup([[...eights, c('red', '1')], [c('red', '2')], [c('red', '3')]], c('red', '8'));
  G.applyAction(s, 'p0', { type: 'play', cardIds: eights.map((e) => e.id) });
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(G.topCard(s).id, eights[2].id);
  assert.equal(s.currentColor, 'yellow', 'det sidste kort bestemmer farven');
  assert.equal(s.current, 1);
  assert.match(s.log.at(-1).text, /3 × 8/);
});

test('det første kort skal passe, og resten skal have samme værdi', () => {
  const s = setup(
    [[c('blue', '8'), c('red', '8'), c('red', '9'), c(null, 'wild'), c(null, 'wild')], [c('red', '2')]],
    c('red', '5'),
  );
  const [blue8, red8, red9, w1, w2] = s.players[0].hand;
  assert.throws(() => G.applyAction(s, 'p0', { type: 'play', cardIds: [blue8.id, red8.id] }), /kan ikke lægges/);
  assert.throws(() => G.applyAction(s, 'p0', { type: 'play', cardIds: [red8.id, red9.id] }), /samme tal/);
  assert.throws(() => G.applyAction(s, 'p0', { type: 'play', cardIds: [w1.id, w2.id], color: 'red' }), /Sorte kort/);
  assert.throws(() => G.applyAction(s, 'p0', { type: 'play', cardIds: [red8.id, red8.id] }), /to gange/);
  G.applyAction(s, 'p0', { type: 'play', cardIds: [red8.id, blue8.id] });
  assert.equal(s.currentColor, 'blue');
});

test('flere ens kan slås fra som husregel', () => {
  const s = setup([[c('red', '8'), c('blue', '8'), c('red', '1')], [c('red', '2')]], c('red', '5'), {
    multiPlay: false,
  });
  const [a, b] = s.players[0].hand;
  assert.throws(() => G.applyAction(s, 'p0', { type: 'play', cardIds: [a.id, b.id] }), /ét kort ad gangen/);
});

test('to spring over springer to spillere over, to +2 giver 4 kort', () => {
  const filler = () => [c('green', '1'), c('green', '2')];
  let s = setup([[c('red', 'skip'), c('blue', 'skip'), ...filler()], filler(), filler(), filler()], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardIds: s.players[0].hand.slice(0, 2).map((x) => x.id) });
  assert.equal(s.current, 3);

  s = setup([[c('red', 'draw2'), c('blue', 'draw2'), ...filler()], filler(), filler()], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardIds: s.players[0].hand.slice(0, 2).map((x) => x.id) });
  assert.equal(s.players[1].hand.length, 6);
  assert.equal(s.current, 2);

  s = setup([[c('red', 'reverse'), c('blue', 'reverse'), ...filler()], filler(), filler()], c('red', '5'));
  G.applyAction(s, 'p0', { type: 'play', cardIds: s.players[0].hand.slice(0, 2).map((x) => x.id) });
  assert.equal(s.direction, 1, 'to retningsskift ophæver hinanden');
  assert.equal(s.current, 1);
});

test('efter man har trukket, må man kun lægge det trukne kort', () => {
  const s = setup([[c('blue', '8'), c('red', '1')], [c('red', '2')]], c('green', '5'));
  const drawn = c('green', '8');
  s.drawPile.push(drawn);
  G.applyAction(s, 'p0', { type: 'draw' });
  assert.throws(
    () => G.applyAction(s, 'p0', { type: 'play', cardIds: [drawn.id, s.players[0].hand[0].id] }),
    /lige har trukket/,
  );
});

test('UNO kan siges i egen tur før man lægger flere ens ned til ét kort', () => {
  const s = setup(
    [
      [c('red', '8'), c('blue', '8'), c('green', '1')],
      [c('red', '2'), c('red', '3'), c('red', '4')],
    ],
    c('red', '5'),
  );
  const [r8, b8] = s.players[0].hand;
  assert.throws(() => G.applyAction(s, 'p1', { type: 'uno' }), /1-2 kort/, 'ikke uden for egen tur med mange kort');
  G.applyAction(s, 'p0', { type: 'uno' });
  G.applyAction(s, 'p0', { type: 'play', cardIds: [r8.id, b8.id] });
  assert.equal(s.unoTarget, null);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'catch', targetId: 'p0' }), /For sent/);
});

test('UNO sagt for tidligt tæller ikke, hvis man ender med flere kort', () => {
  const s = setup(
    [
      [c('red', '1'), c('red', '2'), c('red', '3')],
      [c('blue', '1'), c('blue', '2')],
    ],
    c('red', '5'),
  );
  G.applyAction(s, 'p0', { type: 'uno' });
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.players[0].saidUno, false);
});

// Håndregnet: Mattel-reglen "If the last card played in a hand is a Draw Two or Wild Draw Four card,
// the next player must draw the 2 or 4 cards respectively. These cards are counted when the points are totalled."
test('slutter runden på +2 med stabling, trækker næste spiller og kortene tæller med', () => {
  const s = setup([[c('red', 'draw2')], [c('blue', '7')], [c('green', '3')]], c('red', '5'), { stacking: true });
  s.drawPile = [c('yellow', '9'), c('green', '4')]; // trækkes i rækkefølgen grøn 4, gul 9
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.phase, 'roundOver');
  assert.equal(s.players[1].hand.length, 3);
  // Far: blå 7 + grøn 4 + gul 9 = 20, Ida: grøn 3 = 3 → 23 point (før rettelsen: 7 + 3 = 10)
  assert.equal(s.points, 23);
  assert.equal(s.pendingDraw, 0);
});

test('samme hånd uden stabling giver de samme point', () => {
  const s = setup([[c('red', 'draw2')], [c('blue', '7')], [c('green', '3')]], c('red', '5'));
  s.drawPile = [c('yellow', '9'), c('green', '4')];
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  assert.equal(s.points, 23);
});

test('slutter runden på en stablet +2, trækker næste hele bunken', () => {
  const s = setup([[c('red', 'draw2'), c('red', '1')], [c('blue', 'draw2')], [c('green', '3')]], c('red', '5'), {
    stacking: true,
  });
  s.drawPile = [c('red', '2'), c('red', '2'), c('red', '2'), c('red', '2')];
  G.applyAction(s, 'p0', { type: 'play', cardId: s.players[0].hand[0].id });
  G.applyAction(s, 'p1', { type: 'play', cardId: s.players[1].hand[0].id }); // Far vinder på en stablet +2 (i alt +4)
  assert.equal(s.winnerId, 'p1');
  assert.equal(s.players[2].hand.length, 5); // Ida: grøn 3 + 4 × rød 2
  // Mor: rød 1 = 1, Ida: 3 + 4·2 = 11 → 12 point (før rettelsen: 1 + 3 = 4)
  assert.equal(s.points, 12);
});
