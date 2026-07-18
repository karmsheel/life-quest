import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Parent /root/package-lock.json was stealing Turbopack's workspace root and
  // breaking client bundles when the app is opened via the machine IP.
  turbopack: {
    root: projectRoot,
  },
  // Allow accessing the dev server via LAN IP (not only localhost).
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "153.92.1.195",
  ],
};

export default nextConfig;
