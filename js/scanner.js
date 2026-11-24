/* scanner.js — motor de lectura de códigos.
 *
 * Dos caminos:
 *  1. BarcodeDetector nativo (Chrome/Android): rápido, sin CPU extra.
 *  2. ZXing (@zxing/browser) como respaldo universal: escritorio y navegadores
 *     sin la Shape Detection API.
 *
 * La cámara requiere contexto seguro: HTTPS o localhost. En HTTP la app debe
 * avisar en vez de fallar en silencio.
 */

const NATIVE_FORMATS = [
  'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128',
  'code_39', 'code_93', 'itf', 'codabar', 'data_matrix', 'pdf417', 'aztec',
];

const FORMAT_LABELS = {
  qr_code: 'QR', ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E',
  code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93', itf: 'ITF',
  codabar: 'Codabar', data_matrix: 'Data Matrix', pdf417: 'PDF417', aztec: 'Aztec',
  QR_CODE: 'QR', EAN_13: 'EAN-13', EAN_8: 'EAN-8', UPC_A: 'UPC-A', UPC_E: 'UPC-E',
  CODE_128: 'Code 128', CODE_39: 'Code 39', CODE_93: 'Code 93', ITF: 'ITF',
  DATA_MATRIX: 'Data Matrix', PDF_417: 'PDF417', AZTEC: 'Aztec',
};

export function formatLabel(format) {
  // ZXing devuelve el formato como enum numérico (p. ej. 11 = QR_CODE):
  // se traduce con el mapa inverso que expone la propia librería.
  let key = format;
  if (typeof format === 'number' && window.ZXing?.BarcodeFormat) {
    key = window.ZXing.BarcodeFormat[format] ?? format;
  }
  // Idempotente: quien ya recibe una etiqueta legible ("QR") la conserva.
  if (Object.values(FORMAT_LABELS).includes(key)) return key;
  return FORMAT_LABELS[key] || String(key ?? 'desconocido').toLowerCase();
}

export function isSecureContextOk() {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

async function nativeFormats() {
  if (!('BarcodeDetector' in window)) return [];
  try {
    const all = await window.BarcodeDetector.getSupportedFormats();
    return NATIVE_FORMATS.filter((f) => all.includes(f));
  } catch {
    return [];
  }
}

export async function engineInfo() {
  const native = await nativeFormats();
  return {
    engine: native.length ? 'BarcodeDetector' : 'ZXing',
    formats: native.length ? native : Object.keys(FORMAT_LABELS).slice(0, 13),
  };
}

export class Scanner {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video
   * @param {(r:{value:string,format:string})=>void} opts.onDetect
   * @param {(msg:string,kind?:string)=>void} [opts.onStatus]
   * @param {number} [opts.cooldownMs] evita lecturas repetidas del mismo código
   */
  constructor({ video, onDetect, onStatus, cooldownMs = 1500 }) {
    this.video = video;
    this.onDetect = onDetect;
    this.onStatus = onStatus || (() => {});
    this.cooldownMs = cooldownMs;
    this.stream = null;
    this.running = false;
    this.track = null;
    this._nativeDetector = null;
    this._zxingControls = null;
    this._lastValue = '';
    this._lastAt = 0;
    this._facing = 'environment';
    this._torchOn = false;
  }

  get torchSupported() {
    if (!this.track) return false;
    const caps = this.track.getCapabilities?.();
    return Boolean(caps?.torch);
  }

  async start(facing = this._facing) {
    if (this.running) return;
    if (!isSecureContextOk()) {
      throw new Error('La cámara necesita HTTPS. Abre la app desde su dirección https:// (o localhost en la computadora).');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite abrir la cámara.');
    }

    this._facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    });
    this.track = this.stream.getVideoTracks()[0] || null;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;

    const native = await nativeFormats();
    if (native.length) {
      this._nativeDetector = new window.BarcodeDetector({ formats: native });
      this.onStatus(`Motor nativo (${native.length} formatos). Apunta al código.`);
      this._nativeLoop();
    } else {
      await this._zxingLoop();
      this.onStatus('Motor ZXing. Apunta al código.');
    }
  }

  _emit(value, format) {
    const now = Date.now();
    if (value === this._lastValue && now - this._lastAt < this.cooldownMs) return;
    this._lastValue = value;
    this._lastAt = now;
    this.onDetect({ value, format: formatLabel(format) });
  }

  async _nativeLoop() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    while (this.running) {
      if (this.video.readyState >= 2) {
        const w = this.video.videoWidth;
        const h = this.video.videoHeight;
        if (w && h) {
          // Se reduce la resolución de análisis: suficiente para leer y 4x más rápido.
          const scale = Math.min(1, 720 / Math.max(w, h));
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
          try {
            const codes = await this._nativeDetector.detect(canvas);
            if (codes?.length) this._emit(codes[0].rawValue, codes[0].format);
          } catch { /* cuadro no legible, se ignora */ }
        }
      }
      await new Promise((r) => setTimeout(r, 180));
    }
  }

  async _zxingLoop() {
    const ZB = window.ZXingBrowser;
    if (!ZB?.BrowserMultiFormatReader) throw new Error('No se cargó el motor ZXing.');
    let reader;
    const ZX = window.ZXing;
    try {
      const hints = new Map();
      if (ZX?.DecodeHintType && ZX?.BarcodeFormat) {
        const DT = ZX.DecodeHintType;
        const BF = ZX.BarcodeFormat;
        hints.set(
          DT.POSSIBLE_FORMATS,
          [BF.QR_CODE, BF.EAN_13, BF.EAN_8, BF.UPC_A, BF.UPC_E, BF.CODE_128,
           BF.CODE_39, BF.CODE_93, BF.ITF, BF.DATA_MATRIX, BF.PDF_417, BF.AZTEC]
            .filter(Boolean)
        );
        hints.set(DT.TRY_HARDER, false);
      }
      reader = new ZB.BrowserMultiFormatReader(hints.size ? hints : undefined);
    } catch {
      reader = new ZB.BrowserMultiFormatReader();
    }
    this._zxingControls = await reader.decodeFromVideoElement(this.video, (result, err) => {
      if (result) this._emit(result.getText(), result.getBarcodeFormat());
      // ZXing emite NotFoundException en cada cuadro sin código: no es un error real.
      void err;
    });
  }

  async toggleTorch() {
    if (!this.track || !this.torchSupported) return false;
    this._torchOn = !this._torchOn;
    await this.track.applyConstraints({ advanced: [{ torch: this._torchOn }] });
    return this._torchOn;
  }

  stop() {
    this.running = false;
    try { this._zxingControls?.stop?.(); } catch { /* ya detenido */ }
    this._zxingControls = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.track = null;
    this._torchOn = false;
    this._nativeDetector = null;
    if (this.video) this.video.srcObject = null;
  }

  /** Lee un código desde una imagen ya cargada (galería o captura). */
  async decodeImageElement(img) {
    const native = await nativeFormats();
    if (native.length) {
      const detector = new window.BarcodeDetector({ formats: native });
      const codes = await detector.detect(img);
      if (codes?.length) return { value: codes[0].rawValue, format: formatLabel(codes[0].format) };
    }
    const ZB = window.ZXingBrowser;
    if (!ZB?.BrowserMultiFormatReader) throw new Error('Sin motor de lectura disponible.');
    const reader = new ZB.BrowserMultiFormatReader();
    try {
      const result = await reader.decodeFromImageElement(img);
      return { value: result.getText(), format: formatLabel(result.getBarcodeFormat()) };
    } finally {
      try { reader.reset?.(); } catch { /* ignorar */ }
    }
  }
}
