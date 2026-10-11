// Værten kører det rigtige spil og sender hver spiller deres eget udsnit.
// Forbindelser er abstrakte: { send(msg), onData(fn), onClose(fn), close() }.

import * as G from './game.js';

export class Host {
  constructor({ code, me, saved = null, onView, onSave }) {
    this.code = code;
    this.hostId = me.id;
    this.roster = saved?.roster ?? [{ id: me.id, name: me.name }];
    this.settings = { ...G.DEFAULT_SETTINGS, ...saved?.settings };
    this.scores = saved?.scores ?? {};
    this.game = saved?.game ?? null;
    this.round = saved?.round ?? 0;
    this.conns = new Map();
    this.onView = onView ?? (() => {});
    this.onSave = onSave ?? (() => {});
  }

  snapshot() {
    const { code, hostId, roster, settings, scores, game, round } = this;
    return { code, hostId, roster, settings, scores, game, round };
  }

  addConnection(conn) {
    conn.onData((msg) => this.handleMessage(conn, msg));
    conn.onClose(() => {
      if (conn.playerId && this.conns.get(conn.playerId) === conn) {
        this.conns.delete(conn.playerId);
        this.broadcast();
      }
    });
  }

  handleMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') return this.join(conn, msg);
    if (!conn.playerId) return;
    if (msg.t === 'action') return this.act(conn.playerId, msg.action);
    if (msg.t === 'leave') {
      this.removePlayer(conn.playerId);
      conn.close();
    }
  }

  join(conn, { id, name }) {
    id = String(id ?? '').slice(0, 64);
    name = cleanName(name);
    if (!id || !name) return reject(conn, 'Skriv et navn');

    const existing = this.roster.find((p) => p.id === id);
    if (!existing) {
      if (this.game?.phase === 'playing') return reject(conn, 'Spillet er i gang – prøv igen, når runden er slut');
      if (this.roster.length >= G.MAX_PLAYERS) return reject(conn, `Spillet er fuldt (max ${G.MAX_PLAYERS})`);
      this.roster.push({ id, name: this.uniqueName(name) });
    }

    const old = this.conns.get(id);
    if (old && old !== conn) old.close();
    conn.playerId = id;
    this.conns.set(id, conn);
    this.broadcast();
  }

  uniqueName(name) {
    const taken = new Set(this.roster.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  }

  act(playerId, action) {
    try {
      this.apply(playerId, action);
    } catch (err) {
      if (!(err instanceof G.GameError)) console.error(err);
      this.sendTo(playerId, { t: 'error', msg: err.message });
      return;
    }
    this.broadcast();
  }

  apply(playerId, action) {
    const isHost = playerId === this.hostId;
    switch (action?.type) {
      case 'start': {
        if (!isHost) throw new G.GameError('Kun værten kan starte');
        if (this.game?.phase === 'playing') throw new G.GameError('Runden er allerede i gang');
        if (action.resetScores) this.scores = {};
        this.round += 1;
        this.game = G.newRound(this.roster, this.settings, {
          startIndex: (this.round - 1) % this.roster.length,
          round: this.round,
        });
        return;
      }
      case 'settings': {
        if (!isHost) throw new G.GameError('Kun værten kan ændre regler');
        if (this.game?.phase === 'playing') throw new G.GameError('Regler kan ikke ændres midt i en runde');
        for (const key of Object.keys(G.DEFAULT_SETTINGS)) {
          if (key in action.settings) this.settings[key] = Boolean(action.settings[key]);
        }
        return;
      }
      case 'kick': {
        if (!isHost) throw new G.GameError('Kun værten kan fjerne spillere');
        if (action.targetId === this.hostId) throw new G.GameError('Værten kan ikke fjerne sig selv');
        const conn = this.conns.get(action.targetId);
        conn?.send({ t: 'kicked' });
        setTimeout(() => conn?.close(), 300);
        this.removePlayer(action.targetId, false);
        return;
      }
      default: {
        if (!this.game) throw new G.GameError('Spillet er ikke startet');
        const before = this.game.phase;
        G.applyAction(this.game, playerId, action);
        this.scoreIfFinished(before);
      }
    }
  }

  scoreIfFinished(phaseBefore) {
    if (phaseBefore === 'playing' && this.game.phase === 'roundOver') {
      const w = this.game.winnerId;
      this.scores[w] = (this.scores[w] ?? 0) + this.game.points;
    }
  }

  removePlayer(playerId, broadcast = true) {
    this.roster = this.roster.filter((p) => p.id !== playerId);
    this.conns.delete(playerId);
    delete this.scores[playerId];
    if (this.game) {
      const before = this.game.phase;
      G.removePlayer(this.game, playerId);
      this.scoreIfFinished(before);
    }
    if (broadcast) this.broadcast();
  }

  sendTo(playerId, msg) {
    if (playerId === this.hostId) this.onView(null, msg);
    else this.conns.get(playerId)?.send(msg);
  }

  viewFor(playerId) {
    return {
      code: this.code,
      hostId: this.hostId,
      me: playerId,
      round: this.round,
      settings: this.settings,
      roster: this.roster.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.id === this.hostId || this.conns.has(p.id),
        score: this.scores[p.id] ?? 0,
      })),
      game: this.game ? G.viewFor(this.game, playerId) : null,
    };
  }

  broadcast() {
    for (const p of this.roster) {
      if (p.id === this.hostId) this.onView(this.viewFor(p.id));
      else this.conns.get(p.id)?.send({ t: 'state', view: this.viewFor(p.id) });
    }
    this.onSave(this.snapshot());
  }

  shutdown() {
    for (const conn of this.conns.values()) {
      conn.send({ t: 'ended' });
      conn.close();
    }
    this.conns.clear();
  }
}

function reject(conn, msg) {
  conn.send({ t: 'rejected', msg });
  setTimeout(() => conn.close(), 500);
}

export function cleanName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}
