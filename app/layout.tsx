import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Playfair_Display } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

/** Same type pairing as the premium app: Playfair Display (display) + Inter (UI). */
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], display: "swap" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Sales desk",
  description: "Lead inbox, grounded auto-replies and WhatsApp for the builder's sales team.",
  robots: { index: false, follow: false },
};

// Clerk's provider throws without a publishable key; the pages gate themselves then (lib/auth.ts).
const CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: { children: ReactNode }) {
  const body = (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
  return CLERK ? (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#134232",
          colorForeground: "#1f2a24",
          colorBackground: "#fcfbf9",
          borderRadius: "6px",
          fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
        },
      }}
    >
      {body}
    </ClerkProvider>
  ) : (
    body
  );
}
