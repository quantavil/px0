/**
 * Native client-side WebP image compression helper.
 * Compresses an image file locally in the browser using createImageBitmap and Canvas.
 * Proportionally scales dimensions bounded to maxDim (default 1280px).
 * Encodes to WebP (quality 0.65), falling back to JPEG if WebP is unsupported.
 * Returns a data URI string: "data:image/webp;base64,..."
 */
export async function compressImageToWebP(
  file: File,
  maxDim = 1280,
  quality = 0.65,
): Promise<string> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await createImageBitmap(file);
  }

  try {
    let width = bmp.width;
    let height = bmp.height;

    if (
      !width ||
      !height ||
      width <= 0 ||
      height <= 0 ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      throw new Error("Invalid image dimensions");
    }

    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    width = Math.max(1, width);
    height = Math.max(1, height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to obtain 2D canvas rendering context");
    }

    ctx.drawImage(bmp, 0, 0, width, height);

    let dataUrl = canvas.toDataURL("image/webp", quality);
    if (!dataUrl.startsWith("data:image/webp")) {
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }

    return dataUrl;
  } finally {
    if (bmp && typeof bmp.close === "function") {
      bmp.close();
    }
  }
}
