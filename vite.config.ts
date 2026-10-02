import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "KSJ Mutual Vend",
        short_name: "Mutual Vend",
        description: "Four-compartment customer checkout and KSJ setup",
        theme_color: "#14211a",
        background_color: "#f0fdf4",
        display: "standalone",
        start_url: "./",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2,png}"],
        maximumFileSizeToCacheInBytes: 4000000,
      },
    }),
  ],
  server: { port: 5184, strictPort: true },
  preview: { port: 4184, strictPort: true },
});
