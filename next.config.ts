import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "http2.mlstatic.com" }, { protocol: "https", hostname: "http2.mlstatic.com.br" }, { protocol: "https", hostname: "m.media-amazon.com" }] }
};

export default nextConfig;
