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
  height: number
): string | null {
  if (width <= 0 || height <= 0) return null;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
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

export async function decodeQrFromElement(
  el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement
): Promise<string | null> {
  if (el instanceof HTMLCanvasElement) {
    const ctx = el.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const imgData = ctx.getImageData(0, 0, el.width, el.height);
    return decodeQrFromImageData(imgData.data, el.width, el.height);
  }
  if (el instanceof HTMLImageElement) {
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    return drawOnCanvas(el, w, h);
  }
  const serialized = new XMLSerializer().serializeToString(el);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  return decodeQrFromBlob(svgBlob);
}
