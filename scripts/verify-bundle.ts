/**
 * No secret in the BROWSER bundle. Run after `npm run build`:  npm run verify:bundle
 * Scans .next/static for the VALUES of every server secret set in the env
 * (never printed), their env var NAMES, sb_secret_ keys and service_role JWTs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), ".next", "static");
if (!existsSync(ROOT)) {
  console.error("No .next/static — run `npm run build` first.");
  process.exit(1);
}
const SECRETS = ["SALES_INTERNAL_API_KEY", "PREMIUM_SUPABASE_ANON_KEY", "SALES_SUPABASE_SECRET_KEY", "GROQ_API_KEY", "TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID", "CONTACT_HASH_PEPPER", "CLERK_SECRET_KEY"];
const values = SECRETS.map((name) => ({ name, value: process.env[name]?.trim() ?? "" })).filter((v) => v.value.length >= 8);
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files = walk(ROOT).filter((f) => /\.(js|mjs|css|html|json|txt)$/.test(f));
const hits: string[] = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(process.cwd().length + 1);
  for (const { name, value } of values) if (text.includes(value)) hits.push(`${rel}: VALUE of ${name}`);
  // CLERK_SECRET_KEY is named inside Clerk's own SDK (with an empty browser env); value-checked only.
  for (const name of SECRETS.filter((n) => n !== "CLERK_SECRET_KEY")) if (text.includes(name)) hits.push(`${rel}: references ${name}`);
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) hits.push(`${rel}: an sb_secret_ key`);
  for (const jwt of text.match(/eyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g) ?? []) {
    try {
      if (/"role"\s*:\s*"service_role"/.test(Buffer.from(jwt.split(".")[1], "base64url").toString())) hits.push(`${rel}: a service_role JWT`);
    } catch {
      /* not a JWT */
    }
  }
}
console.log(`Scanned ${files.length} client files. Secret values checked: ${values.map((v) => v.name).join(", ") || "none set"}.`);
if (hits.length > 0) {
  console.error(`✗ ${hits.length} leak(s):\n${hits.map((h) => `  - ${h}`).join("\n")}`);
  process.exit(1);
}
console.log("✓ No secret in the client bundle.");
