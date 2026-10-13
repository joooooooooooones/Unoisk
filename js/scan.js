// QR-scanner med kameraet. Bruger browserens egen BarcodeDetector, hvor den findes
// (Chrome på Android), og ellers jsQR (iPhone), som først hentes, når der skal scannes.

let jsQRLoading = null;
function loadJsQR() {
  if (globalThis.jsQR) return Promise.resolve(globalThis.jsQR);
  jsQRLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsQR.min.js';
    s.onload = () => resolve(globalThis.jsQR);
    s.onerror = () => {
      jsQRLoading = null;
      reject(new Error('jsQR'));
    };
    document.head.append(s);
  });
  return jsQRLoading;
}

async function makeDecoder() {
  if ('BarcodeDetector' in globalThis) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      // Falder tilbage til jsQR.
    }
  }
  const jsQR = await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    // Skalér ned: hurtigere, og en QR-kode på en skærm er stor i billedet alligevel.
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

// Starter kameraet i video-elementet og kalder onResult(tekst) for hver QR-kode,
// indtil stop() kaldes. Afviser, hvis der ikke er adgang til kameraet.
export async function startScanner(video, onResult) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera');
  const [stream, decode] = await Promise.all([
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
    makeDecoder(),
  ]);
  let stopped = false;
  let timer = null;
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});

  const tick = async () => {
    if (stopped) return;
    try {
      const text = video.readyState >= 2 ? await decode(video) : null;
      if (text && !stopped) onResult(text);
    } catch {
      // Et enkelt billede, der ikke kunne læses – prøv det næste.
    }
    if (!stopped) timer = setTimeout(tick, 150);
  };
  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}
