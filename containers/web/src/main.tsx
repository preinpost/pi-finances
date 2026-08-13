import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./components/ChatPage";
import { LoginPage } from "./components/LoginPage";
import { initAuth, isAuthed, useAuth } from "./lib/auth";
import { initLocale } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import { initViewportLock } from "./lib/viewport";
import "./styles.css";

function Gate() {
  const { phase, status } = useAuth();
  if (phase === "loading" || !status) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center bg-sidebar">
        <div className="size-2 animate-pulse rounded-full bg-accent" />
      </div>
    );
  }
  if (!isAuthed(status)) return <LoginPage />;
  return <Outlet />;
}

const rootRoute = createRootRoute({
  component: Gate,
});

/** 새 대화 초안 — 첫 메시지 전송 시 서버 session_bound 로 /s/$sessionId 교체 */
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ChatPage,
});

/** 세션별 딥링크 */
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$sessionId",
  component: ChatPage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([chatRoute, sessionRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

initViewportLock();
initTheme();
initLocale();
initAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
