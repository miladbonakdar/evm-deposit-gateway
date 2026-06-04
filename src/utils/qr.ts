import QRCode from "qrcode";

export type QrFormat = "none" | "pngDataUrl" | "svg" | "base64";

export interface QrResult {
  text: string;
  pngDataUrl?: string;
  svg?: string;
  base64?: string;
}

export async function buildQrResult(text: string, format: QrFormat): Promise<QrResult> {
  if (format === "none") {
    return { text };
  }

  if (format === "svg") {
    return { text, svg: await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M" }) };
  }

  const pngDataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1 });

  if (format === "base64") {
    return { text, base64: pngDataUrl.replace(/^data:image\/png;base64,/, "") };
  }

  return { text, pngDataUrl };
}
