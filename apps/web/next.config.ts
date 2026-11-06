import type { NextConfig } from "next";

// The web app and the API share one public URL: Next proxies /api/* and /a/* to the
// server. Note that `next build` bakes these rewrites into the build output, so set
// SERVER_URL before building if the server is not on 127.0.0.1:4000.
const serverUrl = (process.env.SERVER_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

const config: NextConfig = {
  transpilePackages: ["@ethernals/shared"],
  // Lets the dev server (HMR) be opened through a Cloudflare quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Next's gzip would buffer the proxied Server-Sent Events stream (/api/events).
  compress: false,
  experimental: {
    // The proxy drops idle upstream sockets after 30 s by default. Creating an agent
    // or running a hire can take up to a minute, and the SSE stream idles between events.
    proxyTimeout: 10 * 60 * 1000,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${serverUrl}/api/:path*` },
      { source: "/a/:path*", destination: `${serverUrl}/a/:path*` },
    ];
  },
};

export default config;
