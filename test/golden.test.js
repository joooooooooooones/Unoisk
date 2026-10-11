// Golden master: spiller faste, seedede spil og sammenligner med gemt output.
// Ændrer en regel eller pointberegning resultatet, fejler testen – opdatér kun
// med UPDATE_GOLDEN=1 som en erklæret ændring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as G from '../js/game.js';

const FIXTURE = new URL('./fixtures/golden.json', import.meta.url);

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `S${i}` }));

// Fast, deterministisk "spiller": vælger ud fra rng, så alle regler bliver ramt.
function playGame(seed, n, settings) {
  const rng = seeded(seed);
  const s = G.newRound(players(n), settings, { rng, startIndex: seed % n, round: 1 });
  let turns = 0;
  while (s.phase === 'playing' && turns < 5000) {
    turns++;
    const p = G.currentPlayer(s);
    if (s.unoTarget && rng() < 0.3) {
      const catcher = s.players.find((q) => q.id !== s.unoTarget);
      G.applyAction(s, catcher.id, { type: 'catch', targetId: s.unoTarget });
    }
    if (p.hand.length === 2 && rng() < 0.6) G.applyAction(s, p.id, { type: 'uno' });
    const playable = p.hand.filter((c) => G.canPlay(s, c));
    if (playable.length) {
      const card = playable[Math.floor(rng() * playable.length)];
      const twins =
        G.isWild(card) || s.hasDrawn ? [] : p.hand.filter((o) => o.id !== card.id && o.value === card.value);
      const extra = s.settings.multiPlay ? twins.slice(0, Math.floor(rng() * (twins.length + 1))) : [];
      G.applyAction(s, p.id, {
        type: 'play',
        cardIds: [card.id, ...extra.map((o) => o.id)],
        color: G.COLORS[Math.floor(rng() * 4)],
      });
    } else if (s.hasDrawn) {
      G.applyAction(s, p.id, { type: 'pass' });
    } else {
      G.applyAction(s, p.id, { type: 'draw' });
    }
  }
  return {
    seed,
    n,
    settings,
    turns,
    winnerId: s.winnerId,
    points: s.points,
    hands: s.players.map((p) => p.hand.length),
    logCount: s.logSeq,
    lastLog: s.log.slice(-3).map((l) => l.text),
  };
}

function compute() {
  const variants = [{}, { stacking: true }, { drawUntilPlayable: true }, { multiPlay: false }];
  const games = [];
  for (const settings of variants)
    for (const n of [2, 4, 6]) for (const seed of [1, 7, 42]) games.push(playGame(seed, n, settings));
  const points = Object.fromEntries(
    ['0', '5', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'].map((v) => [
      v,
      G.cardPoints({ value: v, color: v.startsWith('wild') ? null : 'red' }),
    ]),
  );
  return { points, games };
}

test('golden master: regler og point er uændrede', () => {
  const actual = compute();
  if (process.env.UPDATE_GOLDEN) writeFileSync(FIXTURE, JSON.stringify(actual, null, 1) + '\n');
  const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(actual.points, expected.points);
  for (let i = 0; i < expected.games.length; i++) assert.deepEqual(actual.games[i], expected.games[i], `spil #${i}`);
});
