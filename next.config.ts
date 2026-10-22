import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  ...(process.env.NODE_ENV === "development" && {
    allowedDevOrigins: ["192.168.92.69"],
  }),
};

export default nextConfig;
