// Netværk. Standard er PeerJS (WebRTC direkte mellem telefonerne).
// Med ?lokal i adressen bruges BroadcastChannel i stedet, så man kan teste
// med flere faner i samme browser uden internet.

const PREFIX = 'unoisk-v1-';
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return code;
}

export const normalizeCode = (code) =>
  String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);

export function createTransport() {
  return new URLSearchParams(location.search).has('lokal') ? localTransport() : peerTransport();
}

// Fælles fejlkoder: 'code-taken', 'not-found', 'network'.
function peerTransport() {
  function wrap(dc) {
    return {
      send: (msg) => dc.open && dc.send(msg),
      onData: (fn) => dc.on('data', fn),
      onClose: (fn) => {
        dc.on('close', fn);
        dc.on('error', fn);
      },
      close: () => dc.close(),
    };
  }

  function errorCode(err) {
    if (err.type === 'unavailable-id') return 'code-taken';
    if (err.type === 'peer-unavailable') return 'not-found';
    return 'network';
  }

  function keepAlive(peer) {
    peer.on('disconnected', () => {
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1000);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !peer.destroyed && peer.disconnected) peer.reconnect();
    });
  }

  return {
    host(code, { onReady, onConnection, onError }) {
      const peer = new Peer(PREFIX + code, { debug: 1 });
      keepAlive(peer);
      peer.on('open', () => onReady());
      peer.on('connection', (dc) => dc.on('open', () => onConnection(wrap(dc))));
      peer.on('error', (err) => onError(errorCode(err), err));
      return { close: () => peer.destroy() };
    },

    join(code, { onOpen, onError }) {
      const peer = new Peer({ debug: 1 });
      let opened = false;
      peer.on('open', () => {
        const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        dc.on('open', () => {
          opened = true;
          onOpen(wrap(dc));
        });
      });
      peer.on('error', (err) => !opened && onError(errorCode(err), err));
      return { close: () => peer.destroy() };
    },
  };
}

function localTransport() {
  const uid = () => Math.random().toString(36).slice(2);

  function conn(channel, self, other) {
    const data = [];
    const closed = [];
    let isOpen = true;
    const handle = (e) => {
      const m = e.data;
      if (m.to !== self || m.from !== other) return;
      if (m.type === 'data') data.forEach((fn) => fn(m.data));
      if (m.type === 'bye' && isOpen) {
        isOpen = false;
        closed.forEach((fn) => fn());
      }
    };
    channel.addEventListener('message', handle);
    addEventListener('pagehide', () => isOpen && channel.postMessage({ from: self, to: other, type: 'bye' }));
    return {
      send: (msg) => isOpen && channel.postMessage({ from: self, to: other, type: 'data', data: msg }),
      onData: (fn) => data.push(fn),
      onClose: (fn) => closed.push(fn),
      close: () => {
        if (!isOpen) return;
        isOpen = false;
        channel.postMessage({ from: self, to: other, type: 'bye' });
        channel.removeEventListener('message', handle);
        closed.forEach((fn) => fn());
      },
    };
  }

  return {
    host(code, { onReady, onConnection }) {
      const channel = new BroadcastChannel(PREFIX + code);
      const self = 'host';
      channel.addEventListener('message', (e) => {
        const m = e.data;
        if (m.to === self && m.type === 'hello') {
          const c = conn(channel, self, m.from);
          channel.postMessage({ from: self, to: m.from, type: 'welcome' });
          onConnection(c);
        }
      });
      setTimeout(onReady, 0);
      return { close: () => channel.close() };
    },

    join(code, { onOpen, onError }) {
      const channel = new BroadcastChannel(PREFIX + code);
      const self = uid();
      const timer = setTimeout(() => onError('not-found'), 2000);
      const onWelcome = (e) => {
        if (e.data.to === self && e.data.type === 'welcome') {
          clearTimeout(timer);
          channel.removeEventListener('message', onWelcome);
          onOpen(conn(channel, self, 'host'));
        }
      };
      channel.addEventListener('message', onWelcome);
      channel.postMessage({ from: self, to: 'host', type: 'hello' });
      return { close: () => channel.close() };
    },
  };
}
