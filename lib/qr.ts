import "server-only";
import QRCode from "qrcode";

/**
 * QR for the join URL, rendered on the server and inlined as a data URL.
 *
 * Learners scanning a projected code is the fastest way into a room, and doing
 * this server-side keeps the QR library out of the browser bundle entirely.
 */
export async function qrDataUrl(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 480,
      color: { dark: "#12151aff", light: "#ffffffff" },
    });
  } catch {
    return null; // the code and URL are always shown too; the QR is a shortcut
  }
}
