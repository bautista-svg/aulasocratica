// Phone photos are often 4000+ px and 5–12 MB. Before uploading, the browser redraws them
// at most IMAGE_MAX_SIDE px on the long side as JPEG, so the AI can read them (5 MB cap).
import { IMAGE_MAX_SIDE, MAX_IMAGE_BYTES, fileExtension } from "@shared/domain/files";

const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

export async function prepareImage(file: File): Promise<File> {
  const ext = fileExtension(file.name);
  const isImage = RESIZABLE.has(file.type) || ["jpg", "jpeg", "png", "webp"].includes(ext);
  if (!isImage || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // the server will report it if it cannot be read
  }
  const longSide = Math.max(bitmap.width, bitmap.height);
  if (longSide <= IMAGE_MAX_SIDE && file.size <= MAX_IMAGE_BYTES) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // White background: transparent PNGs would turn black in JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob: Blob | null = null;
  for (const q of [0.86, 0.75, 0.62, 0.5]) {
    blob = await canvasToBlob(canvas, q);
    if (blob && blob.size <= MAX_IMAGE_BYTES) break;
  }
  if (!blob) return file;
  const name = file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
}
