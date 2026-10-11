// Computerspillere. Bruger kun det, en almindelig spiller må se (viewFor),
// så de ikke snyder. Ren logik uden DOM og timere – værten styrer tempoet.

import { COLORS, isWild } from './game.js';

export const BOT_NAMES = [
  'Robo-Rasmus',
  'Bip-Bodil',
  'Chip-Karl',
  'Byte-Birthe',
  'Pixel-Per',
  'Data-Dorthe',
  'Turbo-Tove',
  'Kode-Kaj',
];

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

function colorCounts(cards) {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const c of cards) if (c.color) counts[c.color] += 1;
  return counts;
}

function bestColor(cards, rng) {
  const counts = colorCounts(cards);
  const max = Math.max(...Object.values(counts));
  return pick(
    COLORS.filter((c) => counts[c] === max),
    rng,
  );
}

function nextPlayer(view, botId) {
  const i = view.players.findIndex((p) => p.id === botId);
  const n = view.players.length;
  return view.players[(((i + view.direction) % n) + n) % n];
}

// Højere er bedre. Sorte kort gemmes til sidst, action-kort bruges når næste er tæt på at vinde.
function score(card, view, botId, counts) {
  if (card.value === 'wild4') return 0;
  if (card.value === 'wild') return 1;
  let s = 10 + counts[card.color] * 3;
  const threat = nextPlayer(view, botId).count <= 2;
  if (['skip', 'reverse', 'draw2'].includes(card.value)) s += threat ? 30 : -2;
  else s += Number(card.value) / 10; // af med høje tal først (færre strafpoint)
  return s;
}

// Returnerer de handlinger, botten vil udføre nu, i rækkefølge.
export function chooseMoves(view, botId, rng = Math.random) {
  if (view.phase !== 'playing' || view.currentId !== botId) return [];
  const hand = view.hand;
  const playable = hand.filter((c) => view.playable.includes(c.id));

  if (playable.length === 0) return [{ type: view.hasDrawn ? 'pass' : 'draw' }];

  const counts = colorCounts(hand);
  const card = [...playable].sort((a, b) => score(b, view, botId, counts) - score(a, view, botId, counts))[0];

  let cardIds = [card.id];
  if (view.settings.multiPlay && !isWild(card) && !view.hasDrawn) {
    const twins = hand.filter((c) => c.id !== card.id && c.value === card.value);
    // Læg det kort til sidst, hvis farve botten har flest af – det bestemmer farven.
    const rest = hand.filter((c) => c.value !== card.value);
    const restCounts = colorCounts(rest);
    twins.sort((a, b) => restCounts[a.color] - restCounts[b.color]);
    cardIds = [card.id, ...twins.map((c) => c.id)];
  }

  const left = hand.filter((c) => !cardIds.includes(c.id));
  const move = { type: 'play', cardIds };
  if (isWild(card)) move.color = bestColor(left, rng);

  const moves = [];
  if (left.length === 1 && rng() < 0.9) moves.push({ type: 'uno' }); // glemmer det en gang imellem
  moves.push(move);
  return moves;
}

// Skal botten fange en, der glemte UNO? Returnerer spiller-id eller null.
export function chooseCatch(view, botId, rng = Math.random) {
  if (view.phase !== 'playing' || !view.unoTarget || view.unoTarget === botId) return null;
  return rng() < 0.6 ? view.unoTarget : null;
}
