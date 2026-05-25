import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  distDir: ".next-codex",
  output: "standalone",
  turbopack: {
    root: path.resolve("."),
  },
};

export default nextConfig;
