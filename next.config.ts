import type { NextConfig } from "next";

// Enforced CSP: only directives that cannot affect how the page renders.
const CSP_ENFORCED = "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'";

// Candidate full policy, sent as Report-Only so violations show in the browser
// console without blocking anything. Next's App Router injects inline scripts, so
// script-src needs 'unsafe-inline' unless nonces are added via middleware. Map
// tiles come from OpenStreetMap; the project marker icon from unpkg.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
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
          { key: "Content-Security-Policy", value: CSP_ENFORCED },
          // Dev mode needs eval for React Refresh; report the candidate policy in production only
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
