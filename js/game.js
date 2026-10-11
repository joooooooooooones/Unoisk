// Ren spillogik for UNO. Ingen DOM og intet netværk, så den kan testes i Node.
// Tilstanden ejes af værten; spillerne får kun et udsnit via viewFor().

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const HAND_SIZE = 7;

export const DEFAULT_SETTINGS = {
  stacking: false, // +2/+4 kan lægges oven på hinanden
  drawUntilPlayable: false, // træk indtil du får et kort, der kan lægges
  multiPlay: true, // flere kort med samme tal/symbol må lægges på én gang
};

const COLOR_NAMES = { red: 'rød', yellow: 'gul', green: 'grøn', blue: 'blå' };
const VALUE_NAMES = {
  skip: 'Spring over',
  reverse: 'Retningsskift',
  draw2: '+2',
  wild: 'Farveskift',
  wild4: '+4 Farveskift',
};

export const isWild = (card) => card.value === 'wild' || card.value === 'wild4';
export const isNumber = (card) => /^[0-9]$/.test(card.value);
export const colorName = (color) => COLOR_NAMES[color] ?? color;

export function cardName(card) {
  if (isWild(card)) return VALUE_NAMES[card.value];
  return `${COLOR_NAMES[card.color]} ${VALUE_NAMES[card.value] ?? card.value}`;
}

export function cardPoints(card) {
  if (isNumber(card)) return Number(card.value);
  if (isWild(card)) return 50;
  return 20;
}

export function createDeck() {
  const cards = [];
  let id = 0;
  const add = (color, value) => cards.push({ id: id++, color, value });
  for (const color of COLORS) {
    add(color, '0');
    for (let twice = 0; twice < 2; twice++) {
      for (let n = 1; n <= 9; n++) add(color, String(n));
      for (const v of ['skip', 'reverse', 'draw2']) add(color, v);
    }
  }
  for (let i = 0; i < 4; i++) {
    add(null, 'wild');
    add(null, 'wild4');
  }
  return cards;
}

export function shuffle(cards, rng = Math.random) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export class GameError extends Error {}

// players: [{ id, name }]. Toppen af trækbunken er sidste element i drawPile.
export function newRound(players, settings = DEFAULT_SETTINGS, { rng = Math.random, startIndex = 0, round = 1 } = {}) {
  if (players.length < MIN_PLAYERS) throw new GameError(`Der skal være mindst ${MIN_PLAYERS} spillere`);
  if (players.length > MAX_PLAYERS) throw new GameError(`Der kan højst være ${MAX_PLAYERS} spillere`);

  const state = {
    players: players.map((p) => ({ id: p.id, name: p.name, hand: [], saidUno: false })),
    drawPile: shuffle(createDeck(), rng),
    discardPile: [],
    currentColor: null,
    current: ((startIndex % players.length) + players.length) % players.length,
    direction: 1,
    pendingDraw: 0,
    hasDrawn: false,
    drawnCardId: null,
    unoTarget: null,
    phase: 'playing',
    winnerId: null,
    points: 0,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    round,
    log: [],
    logSeq: 0,
    rng,
  };

  for (let i = 0; i < HAND_SIZE; i++) {
    for (const p of state.players) p.hand.push(state.drawPile.pop());
  }

  // Startkortet skal være et talkort; andre kort lægges nederst i bunken.
  let first = state.drawPile.pop();
  while (!isNumber(first)) {
    state.drawPile.unshift(first);
    first = state.drawPile.pop();
  }
  state.discardPile.push(first);
  state.currentColor = first.color;

  log(state, `Runde ${round} begynder – ${currentPlayer(state).name} starter`);
  return state;
}

export const topCard = (state) => state.discardPile[state.discardPile.length - 1];
export const currentPlayer = (state) => state.players[state.current];
const findPlayer = (state, id) => state.players.find((p) => p.id === id);

function log(state, text) {
  state.log.push({ id: ++state.logSeq, text });
  if (state.log.length > 30) state.log.shift();
}

function nextIndex(state, steps = 1) {
  const n = state.players.length;
  return (((state.current + state.direction * steps) % n) + n) % n;
}

function advance(state, steps = 1) {
  state.current = nextIndex(state, steps);
  state.hasDrawn = false;
  state.drawnCardId = null;
}

function reshuffle(state) {
  const top = state.discardPile.pop();
  const rest = state.discardPile;
  state.discardPile = [top];
  state.drawPile = shuffle(rest, state.rng ?? Math.random).concat(state.drawPile);
}

// Returnerer de trukne kort (kan være færre end ønsket, hvis alle kort er på hånden).
function drawCards(state, player, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) reshuffle(state);
    if (state.drawPile.length === 0) break;
    drawn.push(state.drawPile.pop());
  }
  player.hand.push(...drawn);
  if (player.hand.length > 1) player.saidUno = false;
  return drawn;
}

export function canPlay(state, card) {
  const top = topCard(state);
  if (state.pendingDraw > 0) {
    if (top.value === 'draw2') return card.value === 'draw2' || card.value === 'wild4';
    return card.value === 'wild4';
  }
  if (state.hasDrawn && card.id !== state.drawnCardId) return false;
  if (isWild(card)) return true;
  return card.color === state.currentColor || card.value === top.value;
}

function requireTurn(state, playerId) {
  if (state.phase !== 'playing') throw new GameError('Runden er slut');
  if (currentPlayer(state).id !== playerId) throw new GameError('Det er ikke din tur');
}

export function applyAction(state, playerId, action) {
  const player = findPlayer(state, playerId);
  if (!player) throw new GameError('Du er ikke med i denne runde');

  switch (action?.type) {
    case 'play':
      return play(state, player, action.cardIds ?? [action.cardId], action.color);
    case 'draw':
      return draw(state, player);
    case 'pass':
      return pass(state, player);
    case 'uno':
      return sayUno(state, player);
    case 'catch':
      return catchUno(state, player, action.targetId);
    default:
      throw new GameError('Ukendt handling');
  }
}

function play(state, player, cardIds, chosenColor) {
  requireTurn(state, player.id);
  if (!Array.isArray(cardIds) || cardIds.length === 0) throw new GameError('Vælg et kort');
  if (new Set(cardIds).size !== cardIds.length) throw new GameError('Samme kort er valgt to gange');
  const cards = cardIds.map((id) => player.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) throw new GameError('Du har ikke det kort');

  const [first] = cards;
  const count = cards.length;
  if (!canPlay(state, first)) throw new GameError('Det kort kan ikke lægges nu');
  if (count > 1) {
    if (!state.settings.multiPlay) throw new GameError('Du kan kun lægge ét kort ad gangen');
    if (state.hasDrawn) throw new GameError('Du kan kun lægge det kort, du lige har trukket');
    if (cards.some(isWild)) throw new GameError('Sorte kort kan kun lægges ét ad gangen');
    if (cards.some((c) => c.value !== first.value)) throw new GameError('Kortene skal have samme tal eller symbol');
  }
  if (isWild(first) && !COLORS.includes(chosenColor)) throw new GameError('Vælg en farve');

  state.unoTarget = null;
  player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
  state.discardPile.push(...cards);
  const last = cards[count - 1];
  state.currentColor = isWild(first) ? chosenColor : last.color;
  if (count === 1) {
    log(state, `${player.name} lagde ${cardName(first)}${isWild(first) ? ` og valgte ${colorName(chosenColor)}` : ''}`);
  } else {
    const label = VALUE_NAMES[first.value] ?? first.value;
    log(state, `${player.name} lagde ${count} × ${label} (${cards.map((c) => colorName(c.color)).join(', ')})`);
  }

  if (player.hand.length > 1) player.saidUno = false; // UNO tæller kun, hvis man ender på ét kort
  if (player.hand.length === 1) {
    if (player.saidUno) log(state, `${player.name}: UNO!`);
    else state.unoTarget = player.id;
  }

  const n = state.players.length;
  const perCard = first.value === 'draw2' ? 2 : first.value === 'wild4' ? 4 : 0;
  const penalty = perCard * count;
  const skips = Math.min(count, n - 1); // man kan højst springe alle de andre over
  if (penalty && state.settings.stacking) {
    state.pendingDraw += penalty;
    advance(state, 1);
  } else if (penalty) {
    const victim = state.players[nextIndex(state, 1)];
    drawCards(state, victim, penalty);
    log(state, `${victim.name} trækker ${penalty} kort og springes over`);
    advance(state, 2);
  } else if (first.value === 'skip' || (first.value === 'reverse' && n === 2)) {
    const skipped = Array.from({ length: skips }, (_, i) => state.players[nextIndex(state, i + 1)].name);
    log(state, `${skipped.join(' og ')} springes over`);
    advance(state, skips + 1);
  } else if (first.value === 'reverse') {
    if (count % 2 === 1) state.direction *= -1;
    advance(state, 1);
  } else {
    advance(state, 1);
  }

  if (player.hand.length === 0) finishRound(state, player);
}

function finishRound(state, winner) {
  state.phase = 'roundOver';
  state.winnerId = winner.id;
  state.unoTarget = null;
  state.pendingDraw = 0;
  state.points = state.players
    .filter((p) => p.id !== winner.id)
    .reduce((sum, p) => sum + p.hand.reduce((s, c) => s + cardPoints(c), 0), 0);
  log(state, `${winner.name} vandt runden og får ${state.points} point!`);
}

function draw(state, player) {
  requireTurn(state, player.id);
  state.unoTarget = null;

  if (state.pendingDraw > 0) {
    const drawn = drawCards(state, player, state.pendingDraw);
    log(state, `${player.name} trak ${drawn.length} kort`);
    state.pendingDraw = 0;
    advance(state, 1);
    return;
  }
  if (state.hasDrawn) throw new GameError('Du har allerede trukket – læg kortet eller pas');

  let drawn = [];
  let last = null;
  do {
    const got = drawCards(state, player, 1);
    if (got.length === 0) break;
    drawn.push(got[0]);
    last = got[0];
  } while (state.settings.drawUntilPlayable && !canPlay(state, last));

  log(state, drawn.length === 1 ? `${player.name} trak et kort` : `${player.name} trak ${drawn.length} kort`);

  if (last && canPlay(state, last)) {
    state.hasDrawn = true;
    state.drawnCardId = last.id;
  } else {
    advance(state, 1);
  }
}

function pass(state, player) {
  requireTurn(state, player.id);
  if (!state.hasDrawn) throw new GameError('Du skal trække et kort, før du kan passe');
  state.unoTarget = null;
  log(state, `${player.name} passede`);
  advance(state, 1);
}

function sayUno(state, player) {
  if (state.phase !== 'playing') throw new GameError('Runden er slut');
  // I sin egen tur må man sige UNO før et træk, der lander på ét kort (fx tre ens fra tre kort).
  const myTurn = currentPlayer(state).id === player.id;
  if (player.hand.length > 2 && !myTurn) throw new GameError('Du kan kun sige UNO, når du har 1-2 kort');
  if (player.saidUno) return;
  player.saidUno = true;
  if (state.unoTarget === player.id) {
    state.unoTarget = null;
    log(state, `${player.name}: UNO! (lige i tide)`);
  } else if (player.hand.length === 1) {
    log(state, `${player.name}: UNO!`);
  }
}

function catchUno(state, catcher, targetId) {
  if (state.phase !== 'playing') throw new GameError('Runden er slut');
  const target = findPlayer(state, targetId);
  if (!target || target.id === catcher.id || state.unoTarget !== target.id || target.hand.length !== 1) {
    throw new GameError('For sent – der er ingen at fange');
  }
  state.unoTarget = null;
  drawCards(state, target, 2);
  log(state, `${catcher.name} fangede ${target.name}, som glemte at sige UNO! ${target.name} trækker 2 kort`);
}

// Fjerner en spiller midt i en runde (fx hvis telefonen er død). Kortene lægges nederst i bunken.
export function removePlayer(state, playerId) {
  const index = state.players.findIndex((p) => p.id === playerId);
  if (index === -1) return;
  const [removed] = state.players.splice(index, 1);
  state.drawPile.unshift(...removed.hand);
  if (state.unoTarget === playerId) state.unoTarget = null;
  log(state, `${removed.name} forlod spillet`);

  if (state.phase !== 'playing') {
    state.current = Math.min(state.current, state.players.length - 1);
    return;
  }
  if (state.players.length < MIN_PLAYERS) {
    finishRound(state, state.players[0]);
    return;
  }
  const n = state.players.length;
  if (index === state.current) {
    state.current = state.direction === 1 ? index % n : (index - 1 + n) % n;
    state.hasDrawn = false;
    state.drawnCardId = null;
    state.pendingDraw = 0;
  } else if (index < state.current) {
    state.current -= 1;
  }
}

// Det, en bestemt spiller må se: egne kort og antallet af de andres.
export function viewFor(state, playerId) {
  const me = findPlayer(state, playerId);
  const myTurn = state.phase === 'playing' && currentPlayer(state).id === playerId;
  const roundOver = state.phase === 'roundOver';
  return {
    round: state.round,
    phase: state.phase,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      count: p.hand.length,
      saidUno: p.saidUno,
      hand: roundOver ? p.hand : undefined,
    })),
    inRound: Boolean(me),
    hand: me ? me.hand : [],
    playable: myTurn ? me.hand.filter((c) => canPlay(state, c)).map((c) => c.id) : [],
    top: topCard(state),
    currentColor: state.currentColor,
    currentId: currentPlayer(state)?.id ?? null,
    direction: state.direction,
    pendingDraw: state.pendingDraw,
    hasDrawn: myTurn && state.hasDrawn,
    drawnCardId: myTurn ? state.drawnCardId : null,
    drawCount: state.drawPile.length,
    unoTarget: state.unoTarget,
    winnerId: state.winnerId,
    points: state.points,
    settings: state.settings,
    log: state.log.slice(-10),
  };
}
