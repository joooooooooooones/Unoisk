// Animationer: kort flyver fra hånden eller en modspiller ned på bunken,
// og fra trækbunken ud til hånden eller modspilleren.
// Skærmen tegnes helt om ved hver opdatering, så vi måler positionerne før og efter
// og lader kopier af kortene flyve imellem dem i et lag oven på spillet.
// De rigtige kort holdes skjult, til kopien er landet. Lyden spilles, når kortet lander.

const PLAY_MS = 380;
const DRAW_MS = 440;
const EASE = 'cubic-bezier(.2, .75, .25, 1)';
const BACK = '<span class="card back"><span class="oval"><span class="sym">UNO</span></span></span>';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const layer = document.createElement('div');
layer.id = 'fx';
layer.setAttribute('aria-hidden', 'true');
document.body.append(layer);

const inFlight = new Map(); // kort-id → antal kopier, der stadig er i luften

// Mens kortene på hånden glider, må hånden ikke snappe – så følger scrollet med kortene.
let settleUntil = 0;
function settle(root, ms) {
  settleUntil = Math.max(settleUntil, Date.now() + ms);
  root.querySelector('.hand')?.classList.add('settling');
  setTimeout(() => {
    if (Date.now() >= settleUntil) root.querySelector('.hand')?.classList.remove('settling');
  }, ms + 20);
}

const rectOf = (el) => {
  const r = el?.getBoundingClientRect();
  return r && r.width ? r : null;
};

export function measure(root) {
  const hand = new Map();
  for (const el of root.querySelectorAll('.hand .card[data-cid]')) hand.set(Number(el.dataset.cid), rectOf(el));
  const opps = new Map();
  for (const el of root.querySelectorAll('.opp[data-pid]'))
    opps.set(el.dataset.pid, rectOf(el.querySelector('.avatar')));
  return {
    hand,
    opps,
    pile: rectOf(root.querySelector('.pile .card')),
    discard: rectOf(root.querySelector('.discard .top')),
  };
}

// Skjul kort, hvis kopi stadig flyver – også når skærmen tegnes om undervejs.
export function hideInFlight(root) {
  if (Date.now() < settleUntil) root.querySelector('.hand')?.classList.add('settling');
  for (const id of inFlight.keys()) for (const el of cardEls(root, id)) el.classList.add('landing');
}

const cardEls = (root, id) => root.querySelectorAll(`[data-cid="${id}"]`);

function land(root, id, reveal) {
  const left = (inFlight.get(id) ?? 1) - 1;
  if (left > 0) return inFlight.set(id, left);
  inFlight.delete(id);
  for (const el of cardEls(root, id)) {
    el.classList.remove('landing');
    el.animate(reveal, { duration: 170, easing: 'ease-out' });
  }
}

function bump(root, pid) {
  root
    .querySelector(`.opp[data-pid="${CSS.escape(pid)}"] .opp-face`)
    ?.animate([{ scale: '1.18' }, { scale: '1' }], { duration: 220, easing: 'ease-out' });
}

// Et kort flyver fra `from` til `to`. Kopien har bredden `width` og placeres midt på `to`.
function fly(
  root,
  {
    from,
    to,
    html,
    width = to?.width,
    delay = 0,
    ms,
    id = null,
    flip = false,
    fromAvatar = false,
    toAvatar = false,
    onLand,
    sound,
  },
) {
  // Uden animation (eller uden et sted at flyve fra/til) kommer lyden alligevel, når kortet ville lande.
  if (reduced.matches || !from || !to || !width) {
    if (sound) setTimeout(sound, delay + ms * 0.8);
    return;
  }
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const el = holder.firstElementChild;
  el.classList.add('flying');
  el.style.setProperty('--card-w', `${width}px`);
  el.style.left = `${to.left + to.width / 2 - width / 2}px`;
  el.style.top = `${to.top + to.height / 2 - width * 0.75}px`;

  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const s0 = from.width / width;
  const s1 = to.width / width;
  const frames = [
    {
      transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${fromAvatar ? -18 : 0}deg)`,
      opacity: fromAvatar ? 0.4 : 1,
    },
    flip ? { offset: 0.75, transform: `translate(${dx * 0.12}px, ${dy * 0.12}px) scale(${s1})`, opacity: 1 } : null,
    { transform: `translate(0, 0) scale(${flip ? 0.02 : s1}, ${s1}) rotate(0deg)`, opacity: toAvatar ? 0.5 : 1 },
  ].filter(Boolean);

  if (id !== null) inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  layer.append(el);
  const anim = el.animate(frames, { duration: ms, delay, easing: EASE, fill: 'backwards' });
  const done = () => {
    el.remove();
    if (id !== null) land(root, id, flip ? [{ scale: '0 1' }, { scale: '1 1' }] : [{ scale: '1.1' }, { scale: '1' }]);
    onLand?.();
    sound?.();
  };
  anim.finished.then(done, done);
}

// Hold et nyt kort på hånden synligt, så man kan se det lande. Hånden snapper til
// kortenes kanter, så vi scroller præcis til et snappunkt – ellers flytter den sig bagefter.
function revealInHand(root, id) {
  const hand = root.querySelector('.hand');
  const card = hand?.querySelector(`[data-cid="${id}"]`);
  if (!card) return;
  const h = hand.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const max = hand.scrollWidth - hand.clientWidth;
  const pad = parseFloat(getComputedStyle(hand).scrollPaddingLeft) || 0;
  const snaps = [
    0,
    max,
    ...[...hand.children].map((el) => hand.scrollLeft + el.getBoundingClientRect().left - h.left - pad),
  ]
    .filter((x) => x >= 0 && x <= max)
    .sort((a, b) => a - b);
  if (c.right > h.right - 12) {
    const need = hand.scrollLeft + c.right - h.right + 16;
    hand.scrollLeft = snaps.find((x) => x >= need) ?? max;
  } else if (c.left < h.left + 12) {
    const need = hand.scrollLeft - (h.left - c.left + 16);
    hand.scrollLeft = snaps.findLast((x) => x <= need) ?? 0;
  }
}

// prev/next er spillets visning før og efter; before er målt på den gamle skærm.
// sound(navn) spiller en lyd – kaldes, når kortene lander.
export function animateChanges(root, { prev, next, me, before, faceHTML, sound = () => {} }) {
  if (!prev || !next || !before || document.hidden) return;
  const still = reduced.matches;
  const newRound = prev.round !== next.round;
  const oldHand = newRound ? [] : prev.hand;
  const oldIds = new Set(oldHand.map((c) => c.id));
  const newIds = new Set(next.hand.map((c) => c.id));
  const drawnByMe = next.hand.filter((c) => !oldIds.has(c.id));
  const handChanged = drawnByMe.length > 0 || oldHand.some((c) => !newIds.has(c.id));
  if (handChanged && !still) settle(root, 300 + 900 + DRAW_MS);
  if (drawnByMe.length === 1 && !still) revealInHand(root, drawnByMe[0].id);
  const after = measure(root);

  // Resten af hånden glider på plads, når et kort forsvinder eller kommer til.
  if (!newRound && !still) {
    for (const el of root.querySelectorAll('.hand .card[data-cid]')) {
      const a = before.hand.get(Number(el.dataset.cid));
      const b = rectOf(el);
      if (!a || !b) continue;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
        el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 260, easing: EASE });
    }
  }

  // 1) Lagte kort flyver ned på bunken – det øverste kort lander sidst.
  let wait = 0;
  if (!newRound && next.top?.id !== prev.top?.id) {
    const mine = prev.hand.filter((c) => !newIds.has(c.id));
    let cards;
    let fromOf;
    let fromAvatar = false;
    if (prev.currentId === me && mine.length) {
      cards = [...mine.filter((c) => c.id !== next.top.id), ...mine.filter((c) => c.id === next.top.id)];
      fromOf = (c) => before.hand.get(c.id);
    } else {
      const was = prev.players.find((p) => p.id === prev.currentId);
      const is = next.players.find((p) => p.id === prev.currentId);
      const n = Math.min(Math.max((was?.count ?? 0) - (is?.count ?? 0), 1), 4);
      cards = [...Array(n - 1).fill(next.under ?? next.top), next.top];
      fromOf = () => before.opps.get(prev.currentId);
      fromAvatar = true;
    }
    const step = 90;
    cards.forEach((c, i) =>
      fly(root, {
        from: fromOf(c),
        to: after.discard,
        html: faceHTML(c),
        delay: i * step,
        ms: PLAY_MS,
        id: c.id === next.top.id || c.id === next.under?.id ? c.id : null,
        fromAvatar,
        sound: () => sound('play'),
      }),
    );
    wait = (cards.length - 1) * step + PLAY_MS * 0.6;
  }

  // 2) Trukne kort flyver fra bunken – med bagsiden op, og vendes, når de lander på din hånd.
  const step = Math.min(110, 900 / Math.max(drawnByMe.length, 1));
  drawnByMe.slice(-12).forEach((c, i) =>
    fly(root, {
      from: before.pile ?? after.pile,
      to: after.hand.get(c.id),
      html: BACK,
      delay: wait + i * step,
      ms: DRAW_MS,
      id: c.id,
      flip: true,
      sound: () => sound('draw'),
    }),
  );
  if (newRound) return;
  for (const q of next.players) {
    if (q.id === me) continue;
    const p = prev.players.find((x) => x.id === q.id);
    const n = Math.min((q.count ?? 0) - (p?.count ?? q.count), 8);
    for (let i = 0; i < n; i++)
      fly(root, {
        from: before.pile ?? after.pile,
        to: after.opps.get(q.id),
        width: after.pile?.width,
        html: BACK,
        delay: wait + i * 110,
        ms: DRAW_MS,
        toAvatar: true,
        onLand: () => bump(root, q.id),
        sound: () => sound('draw'),
      });
  }
}
