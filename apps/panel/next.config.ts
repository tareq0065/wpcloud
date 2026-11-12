import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wpcloud/shared", "@wpcloud/agent"],
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
};

export default nextConfig;

