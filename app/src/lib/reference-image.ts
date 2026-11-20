const MAX_EDGE = 1280;
const MAX_BYTES = 1_500_000;

function jpegName(name: string) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80);
  return `${base || 'reference'}.jpg`;
}

async function encodeJpeg(canvas: HTMLCanvasElement) {
  const qualities = [0.9, 0.75, 0.6, 0.45];
  let last: Blob | null = null;
  for (const quality of qualities) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) continue;
    last = blob;
    if (blob.size <= MAX_BYTES) return blob;
  }
  return last && last.size <= 10 * 1024 * 1024 ? last : null;
}

// M 2.1 uploads this file after connect. M2.5 turns it into image_url.
// Vidu accepts JPEG, PNG, and WebP. A phone photo's EXIF orientation is not applied
// by that engine, so bake a modest JPEG before either path sends it.
export async function prepareReferenceImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw Object.assign(new Error('The reference image could not be prepared.'), { code: 'REFERENCE_IMAGE_INVALID' });
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw Object.assign(new Error('Use a JPEG, PNG, or WebP reference image.'), { code: 'REFERENCE_IMAGE_INVALID' });
    }
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      throw Object.assign(new Error('The reference image could not be prepared.'), { code: 'REFERENCE_IMAGE_INVALID' });
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await encodeJpeg(canvas);
    if (!blob) {
      throw Object.assign(new Error('Use a JPEG, PNG, or WebP reference image under 10 MB.'), { code: 'REFERENCE_IMAGE_INVALID' });
    }
    return new File([blob], jpegName(file.name), { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
