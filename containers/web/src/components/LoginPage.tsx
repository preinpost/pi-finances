import { useState, type FormEvent } from "react";
import { useAppVersion } from "../lib/appVersion";
import { login, refreshAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

export function LoginPage() {
  const t = useT();
  const appVersion = useAppVersion();
  // 아이디는 빈 칸으로 시작 — 사용자가 직접 입력한다.
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(user.trim(), password);
      await refreshAuth();
    } catch (err) {
      setError(err instanceof Error && err.message === "too-many" ? t("loginTooMany") : t("loginFailed"));
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-sidebar px-4">
      {/* 은은한 배경 장식 — 영역 차지 없이 포커스 주지 않는 데코 */}
      <div aria-hidden className="pointer-events-none absolute -top-28 -left-24 size-80 rounded-full bg-accent-soft blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-32 size-96 rounded-full bg-bubble blur-3xl" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--c-ink) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <form
        onSubmit={(e) => void submit(e)}
        className="fade-up relative w-full max-w-sm rounded-2xl border border-line bg-card p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)] md:p-7"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-soft to-bubble font-serif text-[22px] font-semibold text-accent shadow-[inset_0_0_0_1px_var(--c-line)]">
            α
          </span>
          <h1 className="text-[17px] font-semibold text-ink">{t("loginTitle")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("loginSubtitle")}</p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">{t("loginUser")}</span>
          <input
            className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-faint focus:shadow-[0_0_0_3px_var(--c-accent-soft)]"
            autoComplete="username"
            autoFocus
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </label>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">{t("loginPassword")}</span>
          <input
            className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-faint focus:shadow-[0_0_0_3px_var(--c-accent-soft)]"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 w-full rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? t("loginSubmitting") : t("loginSubmit")}
        </button>
        {appVersion && (
          <p className="mt-4 text-center font-mono text-[11px] tabular-nums text-muted">
            {t("appVersion")} {appVersion}
          </p>
        )}
      </form>
    </div>
  );
}
