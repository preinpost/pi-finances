import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

function resolveAppVersion(): string {
  const fromEnv = process.env.PI_FINANCE_VERSION?.trim();
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "VERSION"), join(here, "VERSION")]) {
    try {
      if (!existsSync(candidate)) continue;
      const v = readFileSync(candidate, "utf8").trim();
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return pkg.version;
}

const DEV_SERVER_PORT = process.env.PI_WEB_DEV_PORT ?? "3141";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-64.png", "apple-touch-icon.png"],
      manifest: {
        name: "AlphaFolio",
        short_name: "AlphaFolio",
        description: "Alpha-seeking finance research agent",
        theme_color: "#faf9f5",
        background_color: "#faf9f5",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // API/WS는 캐시하지 않음 (빌드 에셋만 precache)
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        // ⚠️ 네비게이션(HTML)은 캐시하지 않는다 — NetworkFirst 폴백이 예전 index.html을
        // 서빙해 구버전 번들로 롤백되는 경합(배포 후 "옛 UI가 다시 보임")이 있었음.
        // 네트워크 실패 시에만 navigateFallback(프리캐시된 shell)이 대신 응답한다.
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true, // 모바일 기기에서 같은 네트워크로 접속 가능
    proxy: {
      // dev 서버 포트를 바꾸려면 PI_WEB_DEV_PORT (기본 3141)
      "/api": `http://localhost:${DEV_SERVER_PORT}`,
      "/ws": { target: `ws://localhost:${DEV_SERVER_PORT}`, ws: true },
    },
  },
});
