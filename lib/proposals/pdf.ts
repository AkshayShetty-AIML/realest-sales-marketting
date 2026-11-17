import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Proposal } from "../store/types";
import type { ProposalContent } from "./proposals";

/**
 * THE PROPOSAL PDF — A4, on the developer's brand colours: the unit, the
 * all-in cost sheet (each line with its standing: developer-stated, computed
 * from published rates, or the developer's to confirm), the payment plans,
 * and the RERA line (or exemption) on every page. Deterministic: one proposal
 * version always renders the same document.
 */

const hex = (h: string): RGB => (/^#[0-9a-f]{6}$/i.test(h) ? rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255) : rgb(0.06, 0.42, 0.27));
const INK = hex("#1f2a24");
const BODY = hex("#4a5049");
const MUTED = hex("#5f635c");
const LINE = hex("#e8e3db");
const CANVAS = hex("#faf8f5");
const CAUTION = hex("#8a5b14");
const W = 595.28;
const H = 841.89;
const M = 48;

let fontBytes: Promise<Uint8Array[]> | null = null;
const loadFonts = () =>
  (fontBytes ??= Promise.all([
    readFile(join(process.cwd(), "assets", "fonts", "PlayfairDisplay-600.ttf")),
    readFile(join(process.cwd(), "assets", "fonts", "Inter-400.ttf")),
    readFile(join(process.cwd(), "assets", "fonts", "Inter-600.ttf")),
  ]));

function safe(font: PDFFont, text: string): string {
  const set = font.getCharacterSet();
  let out = "";
  for (const ch of text.replace(/\s+/g, " ")) out += set.includes(ch.codePointAt(0)!) ? ch : ch === "₹" ? "Rs " : "?";
  return out;
}

const rupees = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;
const STANDING = { developer: "Developer-stated", computed: "Computed from published rates", to_confirm: "Developer to confirm" } as const;

export async function renderProposalPdf(p: Proposal): Promise<Uint8Array> {
  const c = p.content as ProposalContent;
  if (c.sheet.onRequest) throw new Error("price on request — no proposal to render");
  const sheet = c.sheet;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [d, t4, t6] = await loadFonts();
  const display = await doc.embedFont(d, { subset: true });
  const text = await doc.embedFont(t4, { subset: true });
  const bold = await doc.embedFont(t6, { subset: true });
  const brand = hex(c.brand.primaryColor);
  const footer = `${c.complianceLine} · ${c.brand.builderName} · Proposal v${p.version}, ${new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} · Illustrative — the developer's agreement governs.`;

  let page: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: CANVAS });
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: brand });
    page.drawText(safe(text, footer).slice(0, 160), { x: M, y: 26, size: 7, font: text, color: MUTED });
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < 60) newPage();
  };
  const write = (s: string, o: { size?: number; font?: PDFFont; color?: RGB; x?: number; gap?: number } = {}) => {
    const size = o.size ?? 10;
    ensure(size * 1.5);
    page.drawText(safe(o.font ?? text, s), { x: o.x ?? M, y: y - size, size, font: o.font ?? text, color: o.color ?? BODY });
    y -= size * 1.5 + (o.gap ?? 0);
  };
  const row = (label: string, amount: string, note: string, o: { strong?: boolean; caution?: boolean } = {}) => {
    ensure(30);
    page.drawText(safe(o.strong ? bold : text, label), { x: M, y: y - 10, size: 10, font: o.strong ? bold : text, color: INK });
    const a = safe(bold, amount);
    page.drawText(a, { x: W - M - bold.widthOfTextAtSize(a, 10), y: y - 10, size: 10, font: bold, color: o.caution ? CAUTION : INK });
    if (note) page.drawText(safe(text, note).slice(0, 110), { x: M, y: y - 22, size: 7.5, font: text, color: o.caution ? CAUTION : MUTED });
    y -= note ? 30 : 18;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.5, color: LINE });
  };
  const heading = (s: string) => {
    ensure(40);
    y -= 10;
    write(s.toUpperCase(), { size: 8, font: bold, color: brand, gap: 4 });
  };

  newPage();
  write(c.brand.builderName, { size: 10, font: bold, color: brand });
  write(`${c.property.name} — ${c.unit.label}`, { size: 22, font: display, color: INK, gap: 2 });
  write(`${c.property.locality}, ${c.property.city}${c.buyerFirstName ? ` · Prepared for ${c.buyerFirstName}` : ""}`, { size: 10, gap: 6 });
  write([c.unit.config, c.unit.floor !== null ? `Floor ${c.unit.floor}` : null, c.unit.facing ? `${c.unit.facing} facing` : null, c.unit.carpetSqft ? `${c.unit.carpetSqft.toLocaleString("en-IN")} sq ft carpet` : null].filter(Boolean).join(" · ") || "Unit details as listed", { size: 10, color: INK, gap: 4 });

  heading("All-in cost");
  for (const l of sheet.lines) row(l.label, l.amount === null ? "To confirm" : rupees(l.amount), `${STANDING[l.standing]} · ${l.source}${l.note ? ` · ${l.note}` : ""}`, { caution: l.standing === "to_confirm" });
  row("All-in total", rupees(sheet.total), sheet.toConfirm.length ? `Excludes what the developer is still to confirm: ${sheet.toConfirm.join(", ")}` : "Every line is stated or computed.", { strong: true });

  heading("Payment plans");
  write("Illustrative schedules on the base price. The developer's own plan, and any discount or premium, governs.", { size: 8.5, color: CAUTION, gap: 4 });
  for (const plan of sheet.plans) {
    write(`${plan.label} — ${rupees(plan.effectivePrice)}`, { size: 11, font: bold, color: INK });
    if (plan.adjustment) write(plan.adjustment, { size: 8, color: CAUTION });
    for (const i of plan.instalments) row(`${i.label} (${i.pct}%)`, rupees(i.amount), "");
    y -= 6;
  }

  heading("Compliance");
  write(c.complianceLine, { size: 10, font: bold, color: INK, gap: 2 });
  write(`Prices as verified ${new Date(c.unit.priceAsOf).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}. Government charges use Karnataka's published rates at the time of this proposal.`, { size: 8.5 });
  return doc.save();
}
