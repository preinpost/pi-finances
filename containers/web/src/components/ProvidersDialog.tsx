import { Dialog } from "@base-ui-components/react/dialog";
import { useEffect, useState } from "react";
import type { UIAuthEvent, UIAuthPrompt, UIAuthSession, UIAuthType } from "../../shared/protocol";
import {
  answerProviderLogin,
  cancelProviderLogin,
  logoutProvider,
  pollProviderLogin,
  startProviderLogin,
  useAuthProviders,
  useInvalidateProviders,
} from "../lib/api";
import { useT } from "../lib/i18n";

const inputClass =
  "w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-faint";

function EventLine({ event }: { event: UIAuthEvent }) {
  if (event.type === "auth_url" && event.url) {
    return (
      <p className="text-[12px] text-muted">
        <a href={event.url} target="_blank" rel="noreferrer" className="text-accent underline">
          {event.instructions || event.url}
        </a>
      </p>
    );
  }
  if (event.type === "device_code") {
    return (
      <p className="text-[12px] text-muted">
        {event.verificationUri && (
          <a href={event.verificationUri} target="_blank" rel="noreferrer" className="text-accent underline">
            {event.verificationUri}
          </a>
        )}
        {event.userCode && <span className="ml-2 font-mono text-ink">{event.userCode}</span>}
      </p>
    );
  }
  if (event.message) return <p className="text-[12px] text-muted">{event.message}</p>;
  return null;
}

function PromptForm({
  prompt,
  busy,
  onSubmit,
}: {
  prompt: UIAuthPrompt;
  busy: boolean;
  onSubmit: (value: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");

  if (prompt.type === "select" && prompt.options) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] text-ink">{prompt.message}</p>
        {prompt.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            disabled={busy}
            onClick={() => onSubmit(opt.id)}
            className="rounded-lg border border-line px-3 py-2 text-left text-[13px] text-ink hover:bg-hover disabled:opacity-40"
          >
            <span className="block font-medium">{opt.label}</span>
            {opt.description && <span className="block text-[11px] text-faint">{opt.description}</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value);
      }}
    >
      <p className="text-[12px] text-ink">{prompt.message}</p>
      <input
        className={inputClass}
        type={prompt.type === "secret" ? "password" : "text"}
        autoFocus
        autoComplete="off"
        placeholder={prompt.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="self-end rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-40"
      >
        {t("loginSubmit")}
      </button>
    </form>
  );
}

export function ProvidersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { data, refetch } = useAuthProviders(open);
  const invalidate = useInvalidateProviders();
  const [query, setQuery] = useState("");
  const [flow, setFlow] = useState<UIAuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!flow || flow.done) return;
    const timer = window.setInterval(() => {
      void pollProviderLogin(flow.id)
        .then((next) => {
          setFlow(next);
          if (next.done) {
            void invalidate();
            void refetch();
          }
        })
        .catch(() => {});
    }, 700);
    return () => window.clearInterval(timer);
  }, [flow, invalidate, refetch]);

  const close = () => {
    if (flow && !flow.done) void cancelProviderLogin(flow.id);
    setFlow(null);
    setError(null);
    setQuery("");
    onOpenChange(false);
  };

  const start = async (providerId: string, method: UIAuthType) => {
    setBusy(true);
    setError(null);
    try {
      setFlow(await startProviderLogin(providerId, method));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (value: string) => {
    if (!flow) return;
    setBusy(true);
    try {
      setFlow(await answerProviderLogin(flow.id, value));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const logout = async (providerId: string) => {
    setBusy(true);
    setError(null);
    try {
      await logoutProvider(providerId);
      await invalidate();
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const providers = (data?.providers ?? []).filter((p) => {
    if (!q) return true;
    return `${p.name} ${p.id}`.toLowerCase().includes(q);
  });

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 flex max-h-[82vh] w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-card shadow-xl outline-none">
          <div className="border-b border-line px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">{t("manageProviders")}</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-xs text-faint">
              {t("manageProvidersHint")}
            </Dialog.Description>
          </div>

          {flow ? (
            <div className="thin-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className="text-[13px] font-medium text-ink">
                {flow.providerName}
                <span className="ml-2 font-mono text-[11px] text-faint">{flow.method}</span>
              </div>
              {flow.events.map((event, i) => (
                <EventLine key={i} event={event} />
              ))}
              {flow.prompt && <PromptForm prompt={flow.prompt} busy={busy} onSubmit={(v) => void answer(v)} />}
              {flow.done && !flow.error && (
                <p className="text-[12px] text-emerald-600 dark:text-emerald-400">{t("providerLoginDone")}</p>
              )}
              {flow.error && <p className="text-[12px] text-danger">{flow.error}</p>}
              <div className="mt-auto flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!flow.done) void cancelProviderLogin(flow.id);
                    setFlow(null);
                  }}
                  className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-ink"
                >
                  {flow.done ? t("cancel") : t("providerCancel")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-2">
                <input
                  className={inputClass}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchProviders")}
                />
              </div>
              <div className="thin-scroll flex-1 overflow-y-auto">
                {providers.map((p) => (
                  <div key={p.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{p.name}</div>
                      <div className="truncate font-mono text-[11px] text-faint">{p.id}</div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {p.loggedIn
                          ? `${t("providerSignedIn")}${p.status?.source ? ` · ${p.status.source}` : ""}`
                          : t("providerSignedOut")}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {p.loggedIn && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void logout(p.id)}
                          className="rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-ink"
                        >
                          {t("providerLogout")}
                        </button>
                      )}
                      {p.methods.includes("oauth") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void start(p.id, "oauth")}
                          className="rounded-lg bg-accent px-2 py-1 text-[12px] font-medium text-accent-ink disabled:opacity-40"
                        >
                          {t("providerLoginOAuth")}
                        </button>
                      )}
                      {p.methods.includes("api_key") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void start(p.id, "api_key")}
                          className="rounded-lg border border-line px-2 py-1 text-[12px] text-ink hover:bg-hover disabled:opacity-40"
                        >
                          {t("providerLoginKey")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {providers.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-faint">{t("noProviders")}</div>
                )}
              </div>
            </>
          )}

          {error && !flow && (
            <div className="border-t border-line px-4 py-2 text-[12px] text-danger">{error}</div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
