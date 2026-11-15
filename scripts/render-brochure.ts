/** Dev helper: re-render the latest stored brochure to .data/verify/brochure.pdf (read-only; no premium calls). */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { store } from "../lib/store";
import { renderBrochurePdf } from "../lib/brochure/pdf";

void (async () => {
  const [latest] = await store().listBrochures();
  if (!latest) throw new Error("no brochures yet");
  const t = Date.now();
  const pdf = await renderBrochurePdf(latest.content);
  const out = join(process.cwd(), ".data", "verify");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "brochure.pdf"), pdf);
  console.log(`rendered ${latest.id} (${Math.round(pdf.length / 1024)} KB, ${Date.now() - t} ms) → .data/verify/brochure.pdf`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
