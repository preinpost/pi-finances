import { Dialog } from "@base-ui-components/react/dialog";
import { useEffect, useMemo, useState } from "react";
import { SECRET_FIELDS, SECRET_GROUPS } from "../../shared/secrets";
import { saveSecrets, useInvalidateModels, useSecrets } from "../lib/api";
import { useT } from "../lib/i18n";

const inputClass =
  "w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:border-faint";

export function KeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { data, refetch } = useSecrets(open);
  const invalidateModels = useInvalidateModels();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (open) {
      setDraft({});
      setError(null);
      setStatus("idle");
    }
  }, [open]);

  const byKey = useMemo(
    () => new Map((data?.fields ?? []).map((f) => [f.key, f])),
    [data],
  );

  const close = () => {
    onOpenChange(false);
    setDraft({});
    setError(null);
    setStatus("idle");
  };

  const save = async () => {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft)) {
      if (value.trim()) values[key] = value.trim();
    }
    if (Object.keys(values).length === 0) {
      setError(t("keysNothingToSave"));
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const result = await saveSecrets(values);
      setDraft({});
      setStatus("saved");
      if (result.warning) setError(result.warning);
      await refetch();
      await invalidateModels();
      if (!result.warning) window.setTimeout(close, 500);
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[82vh] w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-card shadow-xl outline-none">
          <div className="border-b border-line px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">{t("manageKeys")}</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-xs text-faint">
              {data?.persistable ? t("keysPersistHint") : t("keysMemoryHint")}
            </Dialog.Description>
          </div>

          <div className="thin-scroll flex flex-1 flex-col gap-5 overflow-y-auto p-4">
            {SECRET_GROUPS.map((group) => (
              <section key={group.id}>
                <h3 className="mb-2 text-[11px] font-medium tracking-wide text-faint uppercase">
                  {t(group.labelKey)}
                </h3>
                <div className="flex flex-col gap-2.5">
                  {SECRET_FIELDS.filter((f) => f.group === group.id).map((field) => {
                    const current = byKey.get(field.key);
                    const configured = current?.configured ?? false;
                    return (
                      <label key={field.key} className="flex flex-col gap-1">
                        <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted">
                          <span>{field.label}</span>
                          <span className={configured ? "text-emerald-600 dark:text-emerald-400" : "text-faint"}>
                            {configured ? t("keysConfigured") : t("keysMissing")}
                          </span>
                        </span>
                        {field.hint ? (
                          <span className="text-[10px] text-faint">{field.hint}</span>
                        ) : null}
                        <input
                          className={inputClass}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={configured ? t("keysKeepPlaceholder") : field.key}
                          value={draft[field.key] ?? ""}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            <div className="min-w-0 flex-1 truncate text-xs">
              {error ? (
                <span className="text-red-500 dark:text-red-400">{error}</span>
              ) : status === "saved" ? (
                <span className="text-emerald-600 dark:text-emerald-400">{t("saved")}</span>
              ) : (
                <span className="text-faint">{t("keysSaveHint")}</span>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-ink"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={status === "saving"}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {status === "saving" ? t("saving") : t("save")}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
