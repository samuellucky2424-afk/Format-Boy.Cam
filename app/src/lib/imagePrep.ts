// Normalize reference uploads to mod-4 dimensions (see X2 SDK notes).

export async function toMod4(file: File | Blob, minimumSide = 4): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode failed'));
      image.src = url;
    });
    const scale = Math.max(1, minimumSide / Math.min(img.naturalWidth, img.naturalHeight));
    const w = Math.max(minimumSide, Math.floor((img.naturalWidth * scale) / 4) * 4);
    const h = Math.max(minimumSide, Math.floor((img.naturalHeight * scale) / 4) * 4);
    if (w === img.naturalWidth && h === img.naturalHeight) return file;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
