// Phone photos are often 4000 px and 6–12 MB; the AI reads images up to 5 MB. Before
// uploading, big photos are resized in the browser (keeps the text legible).
import { IMAGE_MAX_SIDE, MAX_IMAGE_BYTES } from "@shared/domain/files";

const RESIZABLE = ["image/jpeg", "image/png", "image/webp"];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

/** Returns the same file, or a resized JPEG copy when it is a big photo. Never throws. */
export async function prepareImage(file: File): Promise<File> {
  if (!RESIZABLE.includes(file.type)) return file;
  try {
    const img = await loadImage(file);
    const side = Math.max(img.naturalWidth, img.naturalHeight);
    if (file.size <= MAX_IMAGE_BYTES && side <= IMAGE_MAX_SIDE) return file;
    const scale = Math.min(1, IMAGE_MAX_SIDE / side);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.72, 0.6]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= MAX_IMAGE_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
        return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
      }
    }
    return file;
  } catch {
    return file;
  }
}
