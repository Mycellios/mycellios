import mammoth from "mammoth";

const RASTER_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

/**
 * Reads a .docx as data and maps its structure to plain HTML. Underline is kept (mammoth drops it
 * by default); linked files are never opened, and only embedded raster images become data URIs.
 * The caller sanitizes the result before it reaches the page.
 */
export async function convertDocxToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: ["u => u"],
      idPrefix: "docx-",
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async (image) => {
        // mammoth drops an image whose conversion fails, as it does for linked files.
        if (!RASTER_IMAGE_TYPES.has(image.contentType)) throw new Error("Unsupported image");
        return { src: `data:${image.contentType};base64,${await image.readAsBase64String()}` };
      }),
    },
  );
  return result.value;
}
