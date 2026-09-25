import type { NextConfig } from "next";

/** Same-origin `/api/*` → Express API so auth cookies stay first-party (project.mdc). */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Browser: /api/auth/login → Express: /auth/login (docs/API.md)
        source: "/api/:path*",
        destination: `${API_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
