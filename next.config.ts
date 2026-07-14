import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  images: {
    // Cover Art Archive + Wikimedia (used by MusicBrainz enrichment)
    remotePatterns: [
      { protocol: "https", hostname: "coverartarchive.org" },
      { protocol: "https", hostname: "*.archive.org" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
    ],
  },
};
export default nextConfig;
