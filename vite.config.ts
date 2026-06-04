import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "dashboard",
  base: "/dashboard/",
  plugins: [react()],
  build: {
    outDir: "../public/dashboard",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/dashboard/api": "http://localhost:3000"
    }
  }
});
