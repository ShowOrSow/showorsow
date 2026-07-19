import type { NextConfig } from "next";

// The browser always calls same-origin `/api/*`; these rewrites proxy them to
// the real Go backend so the session cookie (SameSite=Lax) works and there is
// no CORS (13-deployment). Dev → http://localhost:8080; prod (Vercel) →
// API_ORIGIN (the VPS HTTPS endpoint). If NEXT_PUBLIC_API_URL is set, the
// client calls that cross-origin backend directly and these rewrites are unused.
const apiOrigin = (process.env.API_ORIGIN || "http://localhost:8080").replace(
  /\/$/,
  "",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
