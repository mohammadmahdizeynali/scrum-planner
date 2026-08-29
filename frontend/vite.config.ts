import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/pwa-192.png", "icons/pwa-512.png"],
      manifest: {
        name: "برنامه‌ریز شخصی",
        short_name: "برنامه‌ریز",
        description: "برنامه‌ریز شخصی: حوزه‌ها، پروژه‌ها، تسک‌ها، اسپرینت و ثبت زمان",
        dir: "rtl",
        lang: "fa",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#4f46e5",
        icons: [
          { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
