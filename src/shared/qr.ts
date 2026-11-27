import jsQR from 'jsqr';

export function decodeQrFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): string | null {
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return result?.data ?? null;
}

function drawOnCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  doc: Document = document
): string | null {
  if (width <= 0 || height <= 0) return null;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  return decodeQrFromImageData(imgData.data, w, h);
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        return drawOnCanvas(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fallback to <img> element (e.g. SVG blobs)
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(url);
    return drawOnCanvas(img, img.naturalWidth || 400, img.naturalHeight || 400);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isCanvasElement(el: Element): el is HTMLCanvasElement {
  const Ctor = el.ownerDocument?.defaultView?.HTMLCanvasElement ?? globalThis.HTMLCanvasElement;
  return typeof Ctor !== 'undefined' && el instanceof Ctor;
}

function isImageElement(el: Element): el is HTMLImageElement {
  const Ctor = el.ownerDocument?.defaultView?.HTMLImageElement ?? globalThis.HTMLImageElement;
  return typeof Ctor !== 'undefined' && el instanceof Ctor;
}

export async function decodeQrFromElement(
  el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement
): Promise<string | null> {
  if (isCanvasElement(el)) {
    if (el.width <= 0 || el.height <= 0) return null;
    return drawOnCanvas(el, el.width, el.height, el.ownerDocument);
  }
  if (isImageElement(el)) {
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    return drawOnCanvas(el, w, h, el.ownerDocument);
  }
  const SerializerCtor =
    el.ownerDocument?.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
  const serialized = new SerializerCtor().serializeToString(el);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  return decodeQrFromBlob(svgBlob);
}
