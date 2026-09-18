/**
 * Wrap one JPEG in a single-page PDF, with no library.
 *
 * The brief files PDFs to Drive. A JPEG can be embedded as-is (DCTDecode), so
 * the whole document is a few objects around the original bytes: no
 * re-encoding, no quality loss, and byte-exact xref offsets we can verify.
 *
 * PNG and WebP are not wrapped — they would need a decoder. The caller uploads
 * those as-is.
 */

export interface JpegInfo {
  width: number;
  height: number;
  components: 1 | 3 | 4;
}

/** Reads the frame header (SOF0–SOF2) for dimensions and colour components. */
export function jpegInfo(bytes: Uint8Array): JpegInfo {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }            // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (components !== 1 && components !== 3 && components !== 4) throw new Error(`unsupported JPEG components: ${components}`);
      return { width, height, components };
    }
    if (marker === 0xda) break; // start of scan: SOF must precede it
    i += 2 + len;
  }
  throw new Error("JPEG frame header not found");
}

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

/**
 * Page size: the image scaled to fit A4 (portrait or landscape by aspect),
 * so Drive's preview looks like a scanned page rather than a wallpaper.
 */
export function pageSizeFor(width: number, height: number): { w: number; h: number } {
  const landscape = width > height;
  const maxW = landscape ? A4_HEIGHT_PT : A4_WIDTH_PT;
  const maxH = landscape ? A4_WIDTH_PT : A4_HEIGHT_PT;
  const scale = Math.min(maxW / width, maxH / height);
  return { w: +(width * scale).toFixed(2), h: +(height * scale).toFixed(2) };
}

export function jpegToPdf(jpeg: Uint8Array): Uint8Array {
  const info = jpegInfo(jpeg);
  const { w, h } = pageSizeFor(info.width, info.height);
  const enc = new TextEncoder();

  const colorSpace = info.components === 1 ? "/DeviceGray" : info.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
  // Adobe CMYK JPEGs are stored inverted; the Decode array corrects it.
  const decode = info.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";

  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

  const objects: Array<Uint8Array | string> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`,
    `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`,
    // object 5 is assembled below because its body is binary
  ];

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (chunk: Uint8Array | string) => {
    const b = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(b);
    pos += b.length;
  };

  push("%PDF-1.4\n%âãÏÓ\n"); // binary comment line, per convention

  objects.forEach((body, idx) => {
    offsets.push(pos);
    push(`${idx + 1} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  });

  offsets.push(pos);
  push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push("\nendstream\nendobj\n");

  const xrefPos = pos;
  const pad = (n: number) => n.toString().padStart(10, "0");
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${pad(o)} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
