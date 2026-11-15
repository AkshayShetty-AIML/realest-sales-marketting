import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { BrochureContent, FitRow } from "./content";
import { shortDate } from "../grounding/facts";

/**
 * PERSONALISED BROCHURE — HOW it looks. Renders a BrochureContent to an A4
 * PDF in the premium design system: Playfair Display for display type, Inter
 * for text, forest / warm canvas / mint, the grade in its grade colour.
 * Deterministic: the same content always renders the same document.
 */

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  forest: hex("#0f6b46"),
  rail: hex("#0e3b2b"),
  canvas: hex("#faf8f5"),
  mint: hex("#e4f1e8"),
  mist: hex("#f1f7f3"),
  ink: hex("#1f2a24"),
  body: hex("#4a5049"),
  muted: hex("#5f635c"),
  line: hex("#e8e3db"),
  sage: hex("#4a6654"),
  ochre: hex("#daa24c"),
  rust: hex("#b7543a"),
  cautionInk: hex("#8a5b14"),
  cautionBg: hex("#f6ebd6"),
  white: rgb(1, 1, 1),
};
const W = 595.28;
const H = 841.89;
const M = 48;

interface Fonts {
  display: PDFFont;
  displayBold: PDFFont;
  text: PDFFont;
  textBold: PDFFont;
}

let fontBytes: Promise<Uint8Array[]> | null = null;
function loadFontBytes(): Promise<Uint8Array[]> {
  // Statically scoped paths, so the build traces only these four files.
  fontBytes ??= Promise.all([
    readFile(join(process.cwd(), "assets", "fonts", "PlayfairDisplay-500.ttf")),
    readFile(join(process.cwd(), "assets", "fonts", "PlayfairDisplay-600.ttf")),
    readFile(join(process.cwd(), "assets", "fonts", "Inter-400.ttf")),
    readFile(join(process.cwd(), "assets", "fonts", "Inter-600.ttf")),
  ]);
  return fontBytes;
}

/** Keeps only characters the font can draw (a missing glyph would throw). */
function safe(font: PDFFont, text: string): string {
  const set = font.getCharacterSet();
  let out = "";
  for (const ch of text.replace(/\s+/g, " ")) {
    const cp = ch.codePointAt(0)!;
    out += set.includes(cp) ? ch : ch === "₹" ? "Rs " : "?";
  }
  return out;
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of safe(font, text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private f: Fonts, private footer: string) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.canvas });
    this.page.drawText(safe(this.f.text, this.footer), { x: M, y: 26, size: 7.5, font: this.f.text, color: C.muted });
    this.y = H - M;
  }
  ensure(h: number) {
    if (this.y - h < 56) this.newPage();
  }
  text(s: string, o: { size?: number; font?: PDFFont; color?: RGB; width?: number; x?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.font ?? this.f.text;
    const lh = size * 1.45;
    for (const line of wrap(font, size, s, o.width ?? W - 2 * M - (o.x ? o.x - M : 0))) {
      this.ensure(lh);
      this.page.drawText(line, { x: o.x ?? M, y: this.y - size, size, font, color: o.color ?? C.body });
      this.y -= lh;
    }
    this.y -= o.gap ?? 0;
  }
  heading(s: string) {
    this.ensure(48);
    this.y -= 14;
    this.page.drawText(safe(this.f.text, s.toUpperCase()), { x: M, y: this.y - 8, size: 8, font: this.f.textBold, color: C.sage });
    this.y -= 14;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.75, color: C.line });
    this.y -= 10;
  }
}

const VERDICT: Record<FitRow["verdict"], { label: string; bg: RGB; fg: RGB }> = {
  match: { label: "Matches", bg: C.mint, fg: C.forest },
  differs: { label: "Differs", bg: C.cautionBg, fg: C.cautionInk },
  check: { label: "Worth checking", bg: C.cautionBg, fg: C.cautionInk },
  not_stated: { label: "You didn't say", bg: hex("#f4f1ec"), fg: C.muted },
};

function gradeColour(grade: string): { bg: RGB; fg: RGB } {
  if (grade.startsWith("A")) return { bg: C.forest, fg: C.white };
  if (grade.startsWith("B")) return { bg: C.ochre, fg: C.ink };
  return { bg: C.rust, fg: C.white };
}

export async function renderBrochurePdf(c: BrochureContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [d5, d6, t4, t6] = await loadFontBytes();
  const f: Fonts = {
    display: await doc.embedFont(d5, { subset: true }),
    displayBold: await doc.embedFont(d6, { subset: true }),
    // Inter is embedded whole: pdf-lib's subsetter drops glyphs from it (Playfair subsets fine).
    text: await doc.embedFont(t4),
    textBold: await doc.embedFont(t6),
  };
  doc.setTitle(`${c.property.name} — brochure`);
  doc.setAuthor(`${c.property.builder} sales team`);
  doc.setCreationDate(new Date(c.generatedAt));
  doc.setModificationDate(new Date(c.generatedAt));
  doc.setProducer("Sales desk");
  doc.setCreator("Sales desk");

  const footer = `Prepared ${shortDate(c.generatedAt)} from the verified premium record of ${c.property.name}. Every figure here comes from that record; nothing is a promise or an offer.`;
  const w = new Writer(doc, f, footer);
  const p = w.page;

  // ── Masthead: forest band ──
  const bandH = 196;
  p.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: C.rail });
  p.drawText(safe(f.textBold, c.buyerFirstName ? `PREPARED FOR ${c.buyerFirstName.toUpperCase()}` : "PREPARED FOR YOU"), { x: M, y: H - 56, size: 8.5, font: f.textBold, color: hex("#a8c9b6") });
  let ty = H - 92;
  for (const line of wrap(f.displayBold, 30, c.property.name, W - 2 * M - 110)) {
    p.drawText(line, { x: M, y: ty, size: 30, font: f.displayBold, color: C.white });
    ty -= 34;
  }
  p.drawText(safe(f.text, `${c.property.place} · by ${c.property.builder}`), { x: M, y: ty + 6, size: 10.5, font: f.text, color: hex("#d7ebdf") });
  p.drawText(safe(f.text, c.property.type), { x: M, y: ty - 10, size: 10.5, font: f.text, color: hex("#d7ebdf") });
  if (c.property.priceLine) p.drawText(safe(f.display, c.property.priceLine), { x: M, y: H - bandH + 22, size: 16, font: f.display, color: C.white });

  // Grade tile (honest grade, never rounded up)
  const g = gradeColour(c.property.grade);
  const gx = W - M - 92;
  const gy = H - 150;
  p.drawRectangle({ x: gx, y: gy, width: 92, height: 92, color: g.bg, borderColor: C.white, borderWidth: 1.5 });
  const gw = f.displayBold.widthOfTextAtSize(c.property.grade, 38);
  p.drawText(c.property.grade, { x: gx + (92 - gw) / 2, y: gy + 36, size: 38, font: f.displayBold, color: g.fg });
  const gl = "HONEST GRADE";
  p.drawText(gl, { x: gx + (92 - f.textBold.widthOfTextAtSize(gl, 7)) / 2, y: gy + 16, size: 7, font: f.textBold, color: g.fg });
  if (c.property.verified) p.drawText("Verified listing", { x: gx + (92 - f.text.widthOfTextAtSize("Verified listing", 7.5)) / 2, y: gy - 14, size: 7.5, font: f.text, color: hex("#d7ebdf") });
  w.y = H - bandH - 26;

  // ── Intro ──
  w.text(c.headline, { size: 18, font: f.display, color: C.ink, gap: 6 });
  w.text(c.intro, { size: 10.5, color: C.body, gap: 2 });

  // ── Fit table ──
  w.heading("How it fits what you asked for");
  const col = [M, M + 108, M + 260, W - M - 96];
  w.ensure(18);
  for (const [i, h] of ["", "You said", "This home", ""].entries()) if (h) w.page.drawText(h, { x: col[i], y: w.y - 8, size: 8, font: f.textBold, color: C.muted });
  w.y -= 16;
  for (const row of c.fit) {
    const homeLines = wrap(f.text, 9.5, row.home, col[3] - col[2] - 10);
    const rh = Math.max(22, homeLines.length * 13 + 9);
    w.ensure(rh);
    const top = w.y;
    w.page.drawText(safe(f.textBold, row.label), { x: col[0], y: top - 13, size: 9.5, font: f.textBold, color: C.ink });
    w.page.drawText(safe(f.text, row.stated), { x: col[1], y: top - 13, size: 9.5, font: f.text, color: row.verdict === "not_stated" ? C.muted : C.ink });
    homeLines.forEach((l, i) => w.page.drawText(l, { x: col[2], y: top - 13 - i * 13, size: 9.5, font: f.text, color: C.ink }));
    const v = VERDICT[row.verdict];
    const vw = f.textBold.widthOfTextAtSize(v.label, 7.5) + 14;
    w.page.drawRectangle({ x: W - M - vw, y: top - 17, width: vw, height: 14, color: v.bg });
    w.page.drawText(v.label, { x: W - M - vw + 7, y: top - 13, size: 7.5, font: f.textBold, color: v.fg });
    w.y = top - rh;
    w.page.drawLine({ start: { x: M, y: w.y + 3 }, end: { x: W - M, y: w.y + 3 }, thickness: 0.5, color: C.line });
  }

  // ── Key facts (two columns) ──
  w.heading("Key facts");
  const half = (W - 2 * M - 20) / 2;
  for (let i = 0; i < c.keyFacts.length; i += 2) {
    const pair = c.keyFacts.slice(i, i + 2);
    const heights = pair.map((kv) => wrap(f.text, 10, kv.value, half).length * 14 + 14);
    const rh = Math.max(...heights) + 6;
    w.ensure(rh);
    pair.forEach((kv, j) => {
      const x = M + j * (half + 20);
      w.page.drawText(safe(f.text, kv.label), { x, y: w.y - 8, size: 8, font: f.text, color: C.muted });
      wrap(f.text, 10, kv.value, half).forEach((l, k) => w.page.drawText(l, { x, y: w.y - 22 - k * 14, size: 10, font: f.textBold, color: C.ink }));
    });
    w.y -= rh;
  }

  // ── Highlights ──
  if (c.highlights.length) {
    w.heading("What's here");
    for (const h of c.highlights) w.text(`•  ${h}`, { size: 10, color: C.body });
  }

  // ── Availability (live, with its verified stamp) ──
  w.heading("Availability");
  const inv = c.inventory;
  w.ensure(44);
  w.page.drawRectangle({ x: M, y: w.y - 38, width: W - 2 * M, height: 38, color: C.mist });
  w.page.drawText(safe(f.textBold, inv.total > 0 ? `${inv.available} of ${inv.total} unit${inv.total === 1 ? "" : "s"} available` : "Unit availability not listed"), { x: M + 12, y: w.y - 16, size: 11, font: f.textBold, color: C.forest });
  w.page.drawText(safe(f.text, inv.lastVerifiedAt ? `Last verified ${shortDate(inv.lastVerifiedAt)} — we re-confirm before any visit.` : "Not yet verified — we'll confirm before any visit."), { x: M + 12, y: w.y - 30, size: 8.5, font: f.text, color: C.body });
  w.y -= 46;

  // ── Honest caveats ──
  if (c.thingsToCheck.length) {
    w.heading("Things to check — we'd rather tell you now");
    for (const t of c.thingsToCheck) w.text(`•  ${t}`, { size: 10, color: C.body, gap: 2 });
  }

  // ── Grade, what it rests on ──
  if (c.property.gradeParts.length) {
    w.heading(`The grade: ${c.property.grade}${c.property.gradeScore !== null ? ` (${c.property.gradeScore}/100)` : ""}`);
    w.text("The premium app grades every listing on its record, not its marketing. What this one rests on:", { size: 9.5, color: C.body, gap: 4 });
    for (const part of c.property.gradeParts) {
      w.ensure(18);
      const barW = W - 2 * M - 150;
      w.page.drawText(part.label, { x: M, y: w.y - 10, size: 9.5, font: f.text, color: C.ink });
      w.page.drawRectangle({ x: M + 100, y: w.y - 12, width: barW, height: 8, color: hex("#e7e1da") });
      w.page.drawRectangle({ x: M + 100, y: w.y - 12, width: (barW * Math.max(0, Math.min(100, part.value))) / 100, height: 8, color: C.forest });
      w.page.drawText(String(Math.round(part.value)), { x: M + 108 + barW, y: w.y - 11, size: 9.5, font: f.textBold, color: C.ink });
      w.y -= 18;
    }
  }

  // ── Next step ──
  w.heading("Next step");
  w.text(c.nextStep, { size: 10.5, font: f.textBold, color: C.forest });

  return doc.save({ useObjectStreams: true });
}
