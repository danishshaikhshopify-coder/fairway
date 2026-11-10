import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Every route here sits behind auth and reads live Supabase data, so
    // there's no static shell worth carving out; instant-navigation
    // validation would just flag every page. shortcut: no route gets
    // instant-nav optimization; revisit per-route with `export const
    // instant` if a specific page's load time becomes a real complaint.
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
