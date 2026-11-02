import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  ...(process.env.NODE_ENV === "development" && {
    allowedDevOrigins: [
      "192.168.92.69",
      "172.20.10.6",
      "172.27.160.1",
      "*.trycloudflare.com",
    ],
  }),
};

export default nextConfig;
