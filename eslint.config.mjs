import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * SECRETS STAY ON THE SERVER. Every key this app holds (the premium
 * x-service-key, the premium Realtime secret, its own Supabase secret, the LLM
 * key, Twilio) is read in exactly one module: lib/env.ts (`import
 * "server-only"`). These rules stop anything else reading them, and stop
 * client components importing server modules.
 */
const SECRET_ENV = [
  "SALES_INTERNAL_API_KEY",
  "PREMIUM_SUPABASE_ANON_KEY",
  "SALES_SUPABASE_SECRET_KEY",
  "GROQ_API_KEY",
  "LLM_FALLBACK_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "CONTACT_HASH_PEPPER",
  "CLERK_SECRET_KEY",
  "EMAIL_WEBHOOK_TOKEN",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    ignores: ["lib/env.ts", "scripts/**", "proxy.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^(${SECRET_ENV.join("|")})$/]`,
          message: "Secrets are read only in lib/env.ts (server-only).",
        },
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_.*(SECRET|SERVICE|TOKEN|KEY_PRIVATE)/]",
          message: "A NEXT_PUBLIC_ variable ships to every browser — never put a secret in one.",
        },
      ],
    },
  },
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/env", "@/lib/premium/client", "@/lib/store", "@/lib/store/*", "@/lib/automation/*", "@/lib/whatsapp/*", "@/lib/grounding/llm", "@/lib/llm", "@/lib/auth", "@/lib/links", "@/lib/inventory", "@/lib/dashboard", "@/lib/scoring/load", "@/lib/brochure/generate", "@/lib/brochure/pdf", "@/lib/inbox-data", "@/lib/premium/marketing-client", "@/lib/marketing/generate", "@/lib/marketing/studio", "@/lib/marketing/data", "@/lib/marketing/capture", "@/lib/marketing/nurture", "@/lib/marketing/approval", "@/lib/marketing/distribution", "@/lib/marketing/harness", "@/lib/marketing/harness/*", "@/lib/marketing/agents", "@/lib/marketing/agents/*", "@/lib/email"],
              message: "Server-only module. Components get data from server components or server actions (app/actions.ts).",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**"]),
]);

export default eslintConfig;
