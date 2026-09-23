import type { NextConfig } from "next";

// Directives that cannot affect how the page renders. Used as the whole policy
// in `next dev`, where React Refresh needs eval.
const CSP_BASE = "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'";

// Full policy, enforced in production builds. It ran as Report-Only first; a
// production browser check on 2026-09-23 (page load, map zoom and click, all four
// tabs, a facility panel) recorded 0 violations. Next's App Router injects inline
// scripts, so script-src needs 'unsafe-inline' unless nonces are added via
// middleware. Map tiles come from OpenStreetMap; the project marker icon from unpkg.
const CSP_PRODUCTION = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  CSP_BASE,
].join("; ");

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent MIME-type sniffing of responses
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Disallow embedding in cross-origin frames (clickjacking)
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Don't leak full URLs to third parties (e.g. OSM tile servers)
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app never needs these browser capabilities
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: process.env.NODE_ENV === "production" ? CSP_PRODUCTION : CSP_BASE,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
