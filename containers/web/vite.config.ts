import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// 개발: npm run dev (포트 5173) — /api, /files는 호스트 백엔드(:8080)로 프록시
// 프로덕션: npm run build → dist/ (server.mjs가 서빙)
export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/files": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
