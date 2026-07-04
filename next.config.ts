import type { NextConfig } from "next";

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
        ],
      },
    ];
  },
};

export default nextConfig;
