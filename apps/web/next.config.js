/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN || "http://localhost:4000";

const nextConfig = {
  reactStrictMode: true,
  // Proxies same-origin `/api/*` browser requests to the NestJS API. This is
  // what makes web+API genuinely same-origin (SEC-15) in local dev without
  // CORS, and mirrors a single-origin production deployment.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

module.exports = nextConfig;
