import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packSignal, unpackSignal, signalText, checkSignal, SignalError } from '../js/lan.js';

// Et tilbud, som Chrome laver det (kun datakanal, adresse skjult bag mDNS).
const CHROME_OFFER = [
  'v=0',
  'o=- 4537656410245245024 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:3809939280 1 udp 2113937151 079b046e-6e7c-4663-98d0-76c09c74bcf6.local 50061 typ host generation 0 network-cost 999',
  'a=candidate:3809939281 1 udp 2113939711 192.168.1.23 50062 typ host generation 0 network-cost 10',
  'a=candidate:3809939282 1 udp 2113939711 fd00::1:2 50063 typ host generation 0 network-cost 10',
  'a=candidate:842163049 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0',
  'a=candidate:3809939280 2 udp 2113937150 192.168.1.23 50064 typ host generation 0',
  'a=ice-ufrag:4ntP',
  'a=ice-pwd:LyM/3ftKrxKkTux/f3A5Tk3L',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 A6:FB:2F:62:67:0B:CB:B9:C4:5F:60:A6:8F:37:C5:86:F6:6D:58:5F:A1:C8:B2:EF:4A:1A:26:72:61:5F:70:80',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

// Et svar, som Firefox laver det (andre linjer og rækkefølge).
const FIREFOX_ANSWER = [
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 1234567890 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 0D:3A:9C:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD',
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 51234 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.168.1.40',
  'a=candidate:0 1 UDP 2122252543 192.168.1.40 51234 typ host',
  'a=candidate:1 1 TCP 2105524479 192.168.1.40 9 typ host tcptype active',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:0123456789abcdef0123456789abcdef',
  'a=ice-ufrag:a1b2c3d4',
  'a=mid:0',
  'a=setup:active',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
  '',
].join('\r\n');

const attr = (sdp, name) => sdp.match(new RegExp(`^a=${name}:(.*)$`, 'm'))?.[1];
const candidates = (sdp) =>
  [...sdp.matchAll(/^a=candidate:\S+ (\d) (\S+) \d+ (\S+) (\d+) typ (\S+)/gm)].map((m) => m.slice(1).join(' '));

test('et tilbud fra Chrome bliver kort og kan bygges op igen', () => {
  const text = packSignal('o', 'ab12', CHROME_OFFER);
  assert.ok(text.length < 220, `koden er for lang til en nem QR-kode: ${text.length} tegn`);
  const { kind, id, sdp } = unpackSignal(text);
  assert.equal(kind, 'o');
  assert.equal(id, 'ab12');
  for (const name of ['ice-ufrag', 'ice-pwd', 'fingerprint', 'setup', 'mid', 'sctp-port'])
    assert.equal(attr(sdp, name), attr(CHROME_OFFER, name), name);
  // Kun UDP-adresser til komponent 1 – TCP og komponent 2 kan ikke bruges til en datakanal.
  assert.deepEqual(candidates(sdp), [
    '1 udp 079b046e-6e7c-4663-98d0-76c09c74bcf6.local 50061 host',
    '1 udp 192.168.1.23 50062 host',
    '1 udp fd00::1:2 50063 host',
  ]);
  assert.match(sdp, /^m=application 50061 UDP\/DTLS\/SCTP webrtc-datachannel$/m);
  assert.ok(sdp.endsWith('\r\n'));
});

test('et svar fra Firefox kan også pakkes', () => {
  const { kind, id, sdp } = unpackSignal(packSignal('a', 'zz99', FIREFOX_ANSWER));
  assert.equal(kind, 'a');
  assert.equal(id, 'zz99');
  assert.equal(attr(sdp, 'setup'), 'active');
  assert.equal(attr(sdp, 'ice-ufrag'), 'a1b2c3d4');
  assert.equal(attr(sdp, 'ice-pwd'), '0123456789abcdef0123456789abcdef');
  assert.equal(attr(sdp, 'fingerprint'), attr(FIREFOX_ANSWER, 'fingerprint'));
  assert.deepEqual(candidates(sdp), ['1 udp 192.168.1.40 51234 host']);
});

test('koden kan læses ud af værtens link – også med + og / i', () => {
  const text = packSignal('o', 'ab12', CHROME_OFFER);
  assert.ok(text.includes('/'));
  const link = `https://example.github.io/Unoisk/?lokal#wifi=${encodeURIComponent(text)}`;
  assert.equal(signalText(link), text);
  assert.equal(signalText(`  ${text}\n`), text);
  assert.equal(checkSignal(link, 'o').id, 'ab12');
});

test('forkerte koder giver en forståelig fejl', () => {
  const offer = packSignal('o', 'ab12', CHROME_OFFER);
  assert.throws(() => checkSignal(offer, 'a'), /værtens egen kode/);
  assert.throws(() => checkSignal(packSignal('a', 'ab12', FIREFOX_ANSWER), 'o'), /spillers kode/);
  for (const bad of ['', 'ABCD', 'https://example.com/', offer.replace('U1~', 'U9~'), offer.slice(0, -10) + '~x'])
    assert.throws(() => unpackSignal(signalText(bad)), SignalError, bad);
  // En adresse må ikke kunne smugle ekstra SDP-linjer ind.
  assert.throws(() => unpackSignal(offer.replace(/~[^~]*$/, '~1@evil\r\na=x')), SignalError);
  assert.throws(() => unpackSignal(offer.replace(/~[^~]*$/, '~99999@1.2.3.4')), SignalError);
});

test('en beskrivelse uden brugbare adresser afvises', () => {
  const noUdp = CHROME_OFFER.split('\r\n')
    .filter((l) => !l.startsWith('a=candidate') || l.includes(' tcp '))
    .join('\r\n');
  assert.throws(() => packSignal('o', 'ab12', noUdp), /Wi-Fi/);
});
