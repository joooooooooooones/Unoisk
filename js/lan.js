// Spil uden internet: telefonerne forbindes direkte over det samme Wi-Fi (WebRTC),
// uden nogen server. Det, der normalt sendes via PeerJS' server, skifter de i stedet
// ved at scanne QR-koder: værten viser et "tilbud", spilleren viser et "svar".
//
// En hel SDP er for stor til en QR-kode, man kan scanne fra en skærm, så kun det,
// der er forskelligt fra gang til gang, pakkes (ICE-nøgler, certifikatets fingeraftryk
// og adresser), og resten bygges op igen på den anden telefon.

const TAG = 'U1';
const MAX_CANDIDATES = 6;
const GATHER_MS = 3000; // længere tid end det tager at finde de lokale adresser
const SETUP = { actpass: 'a', active: 'c', passive: 'p' };
const SETUP_NAME = Object.fromEntries(Object.entries(SETUP).map(([k, v]) => [v, k]));

const toB64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64 = (s) => [...atob(s.replace(/-/g, '+').replace(/_/g, '/'))].map((c) => c.charCodeAt(0));
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

export class SignalError extends Error {}

// kind: 'o' (værtens tilbud) eller 'a' (spillerens svar). id: parrer svaret med tilbuddet.
export function packSignal(kind, id, sdp) {
  const attr = (name) => sdp.match(new RegExp(`^a=${name}:(.*)$`, 'm'))?.[1].trim();
  const ufrag = attr('ice-ufrag');
  const pwd = attr('ice-pwd');
  const fp = attr('fingerprint')?.match(/^sha-256 ([0-9A-Fa-f:]+)$/)?.[1];
  const setup = SETUP[attr('setup')];
  const mid = attr('mid') ?? '0';
  if (!ufrag || !pwd || !fp || !setup) throw new SignalError('Uventet forbindelsesbeskrivelse');

  const seen = new Set();
  const cands = [];
  for (const [, line] of sdp.matchAll(/^a=candidate:(.*)$/gm)) {
    // foundation component protocol priority address port typ type …
    const [, component, protocol, , address, port] = line.trim().split(/\s+/);
    if (component !== '1' || protocol.toLowerCase() !== 'udp' || address.includes('@') || address.includes(','))
      continue;
    const key = `${port}@${address}`;
    if (seen.has(key) || cands.length >= MAX_CANDIDATES) continue;
    seen.add(key);
    cands.push(key);
  }
  if (!cands.length) throw new SignalError('Fandt ingen netværksadresse – er telefonen på Wi-Fi?');

  const fingerprint = toB64(fp.split(':').map((h) => parseInt(h, 16)));
  return [TAG, kind + id, ufrag, pwd, fingerprint, setup + mid, cands.join(',')].join('~');
}

export function unpackSignal(text) {
  const parts = String(text ?? '')
    .trim()
    .split('~');
  if (parts.length !== 7 || parts[0] !== TAG) throw new SignalError('Det er ikke en Unoisk-kode');
  const [, kindId, ufrag, pwd, fingerprint, setupMid, candText] = parts;
  const kind = kindId[0];
  const setup = SETUP_NAME[setupMid[0]];
  const mid = setupMid.slice(1);
  const ice = /^[A-Za-z0-9+/]+$/;
  if (!['o', 'a'].includes(kind) || !setup || !ice.test(ufrag) || !ice.test(pwd) || !/^[\w-]+$/.test(mid))
    throw new SignalError('Koden er ugyldig');
  let fp;
  try {
    fp = fromB64(fingerprint);
  } catch {
    throw new SignalError('Koden er ugyldig');
  }
  if (fp.length !== 32) throw new SignalError('Koden er ugyldig');

  const cands = candText.split(',').map((c) => {
    const at = c.indexOf('@');
    const port = Number(c.slice(0, at));
    const address = c.slice(at + 1);
    if (at < 1 || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[\w.:-]+$/.test(address))
      throw new SignalError('Koden er ugyldig');
    return { port, address };
  });

  const lines = [
    'v=0',
    `o=- ${Math.floor(Math.random() * 1e12)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mid}`,
    `m=application ${cands[0].port} UDP/DTLS/SCTP webrtc-datachannel`,
    'c=IN IP4 0.0.0.0',
    ...cands.map((c, i) => `a=candidate:${i + 1} 1 udp ${2122260223 - i * 256} ${c.address} ${c.port} typ host`),
    'a=end-of-candidates',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    `a=fingerprint:sha-256 ${fp.map(hex).join(':')}`,
    `a=setup:${setup}`,
    `a=mid:${mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  return { kind, id: kindId.slice(1), sdp: lines.join('\r\n') + '\r\n' };
}

// Værtens QR-kode er et link (…#wifi=<kode>), så den også kan scannes med telefonens
// almindelige kamera. Her hentes koden ud af linket igen; ren tekst går lige igennem.
export const LINK_KEY = 'wifi';
export function signalText(text) {
  const s = String(text ?? '').trim();
  const at = s.indexOf(`#${LINK_KEY}=`);
  if (at < 0) return s;
  try {
    return decodeURIComponent(s.slice(at + LINK_KEY.length + 2));
  } catch {
    return '';
  }
}

// Kaster SignalError, hvis teksten ikke er en kode af den ventede slags ('o' eller 'a').
export function checkSignal(text, kind) {
  const signal = unpackSignal(signalText(text));
  if (signal.kind !== kind)
    throw new SignalError(
      kind === 'o' ? 'Det er en spillers kode – scan værtens kode' : 'Det er værtens egen kode – scan spillerens kode',
    );
  return signal;
}

// ---------- WebRTC ----------

// Ingen STUN/TURN: uden internet er der intet at spørge, og på samme Wi-Fi er der ikke brug for det.
const newPeer = () => new RTCPeerConnection({ iceServers: [] });

function gathered(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function wrap(pc, dc) {
  const closed = [];
  let isOpen = true;
  const fireClose = () => {
    if (!isOpen) return;
    isOpen = false;
    closed.forEach((fn) => fn());
    pc.close();
  };
  dc.addEventListener('close', fireClose);
  // 'disconnected' kan rette sig selv (fx et kort udfald på Wi-Fi'en) – 'failed' kan ikke.
  pc.addEventListener('connectionstatechange', () => ['failed', 'closed'].includes(pc.connectionState) && fireClose());
  return {
    send: (msg) => dc.readyState === 'open' && dc.send(JSON.stringify(msg)),
    onData: (fn) =>
      dc.addEventListener('message', (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        fn(msg);
      }),
    onClose: (fn) => closed.push(fn),
    close: () => {
      dc.close();
      fireClose();
    },
  };
}

const newId = () => Math.random().toString(36).slice(2, 6);

// Værten: ét åbent tilbud ad gangen. Når et svar er scannet, og forbindelsen er åben,
// kaldes onConnection, og der laves et nyt tilbud til den næste spiller.
export function lanHost({ onConnection }) {
  let pending = null;
  let closed = false;
  const open = new Set();

  return {
    async offer() {
      pending?.pc.close();
      const pc = newPeer();
      const dc = pc.createDataChannel('unoisk', { ordered: true });
      const id = newId();
      pending = { pc, dc, id };
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      return packSignal('o', id, pc.localDescription.sdp);
    },

    // Tjekker svaret med det samme (kaster SignalError); det returnerede løfte
    // resolver, når spilleren er forbundet, og afviser, hvis forbindelsen ikke kommer.
    accept(text) {
      const signal = checkSignal(text, 'a');
      if (!pending || signal.id !== pending.id)
        throw new SignalError('Koden hører til en ældre invitation – lad spilleren scanne igen');
      const { pc, dc } = pending;
      pending = null;
      return (async () => {
        await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        await opened(pc, dc);
        if (closed) return pc.close();
        const conn = wrap(pc, dc);
        open.add(conn);
        conn.onClose(() => open.delete(conn));
        onConnection(conn);
      })();
    },

    close() {
      closed = true;
      pending?.pc.close();
      pending = null;
      open.forEach((c) => c.close());
    },
  };
}

// Spilleren: læs værtens tilbud, lav et svar. onOpen kaldes, når værten har scannet svaret.
export async function lanJoin(text, { onOpen, onError }) {
  const signal = checkSignal(text, 'o');
  const pc = newPeer();
  let gotChannel = false;
  pc.addEventListener('datachannel', ({ channel }) => {
    gotChannel = true;
    opened(pc, channel, 0).then(
      () => onOpen(wrap(pc, channel)),
      () => onError('network'),
    );
  });
  pc.addEventListener('connectionstatechange', () => {
    if (!gotChannel && pc.connectionState === 'failed') onError('network');
  });
  await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { answer: packSignal('a', signal.id, pc.localDescription.sdp), close: () => pc.close() };
}

// ms = 0: vent uden tidsgrænse (spilleren venter på, at værten scanner).
function opened(pc, dc, ms = 20000) {
  return new Promise((resolve, reject) => {
    if (dc.readyState === 'open') return resolve();
    const timer = ms && setTimeout(() => fail(), ms);
    const fail = () => {
      clearTimeout(timer);
      pc.close();
      reject(new SignalError('Kunne ikke forbinde – er I på det samme Wi-Fi?'));
    };
    dc.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    pc.addEventListener('connectionstatechange', () => pc.connectionState === 'failed' && fail());
  });
}
