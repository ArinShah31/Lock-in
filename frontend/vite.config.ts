import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "localhost",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        timeout: 1_200_000,
        proxyTimeout: 1_200_000,
      },
      "/uploads": {
        target: "http://127.0.0.1:8000",
      },
      "/coding-api": {
        target: "http://127.0.0.1:8010",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/coding-api/, "/api"),
      },
      "/theory-api": {
        target: "http://127.0.0.1:8012",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/theory-api/, "/api"),
      },
    },
  },
});
