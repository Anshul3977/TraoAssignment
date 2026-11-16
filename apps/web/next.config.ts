import type { NextConfig } from "next";

/** Same-origin `/api/*` → Express API so auth cookies stay first-party (project.mdc). */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The public demo (/api/demo) runs the shared @prep/core pipeline in a route
  // handler. Core is TypeScript source with NodeNext-style ".js" imports.
  transpilePackages: ["@prep/core"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async rewrites() {
    // Plain-array rewrites run after filesystem routes, so the local
    // app/api/demo route handler wins over this proxy.
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
