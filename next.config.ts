import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js and pdf-lib run as plain Node modules on the server; bundling them breaks their workers.
  serverExternalPackages: ["pdfjs-dist", "pdf-lib"],
  // Clio only redirects to https or http://127.0.0.1, so the app is opened at 127.0.0.1 in development.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
