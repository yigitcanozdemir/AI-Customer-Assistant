/**
 * Image validation for the visual-search upload.
 *
 * `File.type` is derived from the filename extension, not the bytes — rename an
 * AVIF to `.png` and the browser reports `image/png`. That false MIME travelled
 * all the way to the vision API, which sniffs the real bytes and rejected the
 * whole turn with a 400:
 *
 *   "The image data you provided does not represent a valid image ... supported
 *    image formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']"
 *
 * The failure was near-silent: the backend caught the error, fell back to the
 * original (empty) text, and ran a contextless product search.
 *
 * So we read the magic bytes ourselves. Anything unsupported that the *browser*
 * can still decode (AVIF, HEIC on Safari, BMP, TIFF) is transcoded to JPEG via
 * canvas rather than rejected, which turns a hard failure into a working search.
 */

/** Formats the vision API accepts. Keep in sync with the backend guard. */
export const SUPPORTED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

type Signature = { mime: string; test: (b: Uint8Array) => boolean };

const SIGNATURES: Signature[] = [
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/gif",
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    // RIFF....WEBP
    mime: "image/webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** ftyp brands that identify a decodable-but-unsupported container. */
const FTYP_BRANDS = ["avif", "avis", "heic", "heix", "heif", "mif1", "msf1"];

/**
 * The real MIME from magic bytes, or null if the bytes match nothing we know.
 * Never trust `file.type` — this is the authority.
 */
export async function sniffImageType(file: Blob): Promise<string | null> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  for (const sig of SIGNATURES) {
    if (sig.test(header)) return sig.mime;
  }

  // ISO-BMFF container (AVIF / HEIC): bytes 4-8 are "ftyp", 8-12 the brand.
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...header.slice(start, end)).toLowerCase();
  if (ascii(4, 8) === "ftyp" && FTYP_BRANDS.includes(ascii(8, 12))) {
    return `image/${ascii(8, 12) === "avif" ? "avif" : "heic"}`;
  }

  if (header[0] === 0x42 && header[1] === 0x4d) return "image/bmp";

  return null;
}

/**
 * Re-encode to JPEG using the browser's own decoder, so a format the vision API
 * rejects still works whenever the browser can display it. `maxEdge` also keeps
 * the payload small — the description only needs the garment recognisable, and
 * a 4 MB data URL over the WebSocket is pure waste.
 */
export async function transcodeToJpeg(
  file: Blob,
  maxEdge = 1024,
  quality = 0.85,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    // JPEG has no alpha; without this, transparent PNG/AVIF areas go black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}

/** Read a blob as a data: URL. */
function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export type PreparedImage =
  | { ok: true; dataUrl: string; mime: string; transcoded: boolean }
  | { ok: false; error: string };

/**
 * Validate and prepare a user-picked file for the vision API.
 *
 * Order matters: sniff BEFORE deciding anything, because `file.type` lies.
 * A supported format passes through untouched; anything else the browser can
 * decode is transcoded to JPEG; only a genuinely undecodable file is rejected,
 * and then with a message the customer can act on.
 */
export async function prepareImageForUpload(
  file: File,
  maxBytes: number,
): Promise<PreparedImage> {
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, error: `That image is over ${mb} MB. Try a smaller one.` };
  }

  let sniffed: string | null;
  try {
    sniffed = await sniffImageType(file);
  } catch {
    return { ok: false, error: "That file couldn't be read. Try another image." };
  }

  if (sniffed && (SUPPORTED_IMAGE_MIMES as readonly string[]).includes(sniffed)) {
    try {
      return {
        ok: true,
        dataUrl: await readAsDataURL(file),
        mime: sniffed,
        transcoded: false,
      };
    } catch {
      return { ok: false, error: "That file couldn't be read. Try another image." };
    }
  }

  // Unsupported (AVIF/HEIC/BMP…) or unrecognised bytes: let the browser try to
  // decode it. If it can, we get a clean JPEG the API will accept.
  try {
    const dataUrl = await transcodeToJpeg(file);
    return { ok: true, dataUrl, mime: "image/jpeg", transcoded: true };
  } catch {
    return {
      ok: false,
      error: "That image format isn't supported. Try a JPEG, PNG or WebP.",
    };
  }
}
