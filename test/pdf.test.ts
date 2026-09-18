/**
 * The PDF wrapper is verified structurally: every xref offset must land
 * exactly on its "N 0 obj" header, startxref must point at the xref table,
 * and the embedded JPEG must be byte-identical to the input. A PDF reader
 * that follows the xref (all of them) will then find every object.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { jpegInfo, jpegToPdf, pageSizeFor } from "../src/pdf.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const jpeg = new Uint8Array(readFileSync(path.join(here, "fixtures", "sample.jpg")));
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

test("jpegInfo reads the fixture's dimensions and components", () => {
  const info = jpegInfo(jpeg);
  assert.equal(info.width, 192);
  assert.equal(info.height, 192);
  assert.equal(info.components, 3);
  assert.throws(() => jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), /not a JPEG/);
});

test("pageSizeFor fits A4 and keeps aspect; landscape flips the sheet", () => {
  const p = pageSizeFor(1000, 1414);
  assert.ok(p.w <= 595.28 && p.h <= 841.89);
  assert.ok(Math.abs(p.w / p.h - 1000 / 1414) < 0.001);
  const l = pageSizeFor(1414, 1000);
  assert.ok(l.w <= 841.89 && l.h <= 595.28 && l.w > l.h);
});

test("jpegToPdf: xref offsets are byte-exact and the JPEG is embedded verbatim", () => {
  const pdf = jpegToPdf(jpeg);
  const text = latin1(pdf);

  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.endsWith("%%EOF\n"));

  // startxref → xref table
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");

  // each in-use entry → "N 0 obj"
  const table = text.slice(startxref).match(/xref\n0 (\d+)\n([\s\S]*?)trailer/)!;
  const count = Number(table[1]);
  const entries = table[2].trim().split("\n");
  assert.equal(count, 6);
  assert.equal(entries.length, 6);
  entries.slice(1).forEach((e, i) => {
    const off = Number(e.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`);
  });

  // the image stream is the original bytes, untouched
  const lengthMatch = text.match(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/)!;
  assert.equal(Number(lengthMatch[1]), jpeg.length);
  const streamStart = lengthMatch.index! + lengthMatch[0].length;
  assert.deepEqual(pdf.slice(streamStart, streamStart + jpeg.length), jpeg);
  assert.equal(text.slice(streamStart + jpeg.length, streamStart + jpeg.length + 10), "\nendstream");

  // sanity on declared sizes
  assert.match(text, /\/Width 192 \/Height 192 \/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/MediaBox \[0 0 595\.28 595\.28\]/);
});

test("an independent reader (macOS CoreGraphics via sips) opens the PDF", { skip: process.platform !== "darwin" }, () => {
  const out = path.join(os.tmpdir(), `pa-pdf-check-${process.pid}.pdf`);
  writeFileSync(out, jpegToPdf(jpeg));
  try {
    const res = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", out], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /pixelWidth: \d+/);
    assert.match(res.stdout, /pixelHeight: \d+/);
  } finally {
    unlinkSync(out);
  }
});
