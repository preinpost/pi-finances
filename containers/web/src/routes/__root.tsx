import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useSseStream } from "../hooks/useSseStream";
import StatusBar from "../components/StatusBar";
import ConfirmModal from "../components/ConfirmModal";

export const Route = createRootRoute({
  component: RootLayout,
});

const NAV = [
  { to: "/", label: "챗", match: { to: "/" } as const },
  { to: "/settings", label: "설정", match: { to: "/settings" } as const },
  { to: "/reports", label: "리포트", match: { to: "/reports" } as const },
];

function RootLayout() {
  // SSE 구독은 전역 1회 — 캐시에 이벤트 반영
  useSseStream();

  return (
    <div className="app">
      <header className="topbar">
        <h1>pi 금융분석</h1>
        <nav>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="nav-link" activeProps={{ className: "nav-link active" }}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <StatusBar />
      <ConfirmModal />
    </div>
  );
}
