import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js and pdf-lib run as plain Node modules on the server; bundling them breaks their workers.
  serverExternalPackages: ["pdfjs-dist", "pdf-lib"],
};

export default nextConfig;
