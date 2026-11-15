import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Clerk-hosted avatars in the rep menu.
  images: { remotePatterns: [{ protocol: "https", hostname: "img.clerk.com" }] },
  // Keep the dev badge off the nav rail.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
