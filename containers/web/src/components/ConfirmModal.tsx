import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { uiRequestKey } from "../hooks/useSseStream";
import { useUiResponse } from "../hooks/useRpc";
import type { UiRequest } from "../types";

/**
 * extension_ui_request(confirm/input/editor/select) 모달 — 주문 확인·키 입력 등.
 * 응답(ui_response) 전송 후 캐시를 비워 다음 요청을 받는다.
 */
export default function ConfirmModal() {
  const qc = useQueryClient();
  const req = useQuery({ queryKey: [...uiRequestKey], initialData: null });
  const respond = useUiResponse();
  const [value, setValue] = useState("");

  const ui = req.data as UiRequest | null;

  useEffect(() => {
    if (ui) setValue(ui.prefill ?? "");
  }, [ui]);

  if (!ui) return null;

  const close = () => qc.setQueryData(uiRequestKey, null);

  const send = (payload: Record<string, unknown>) => {
    respond.mutate(
      { id: ui.id, ...payload },
      {
        onSettled: close,
        onError: () => close(),
      },
    );
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{ui.title ?? ui.method}</h3>
        {ui.method === "confirm" && ui.message && <p className="modal-message">{ui.message}</p>}
        {ui.method === "input" && (
          <input
            autoFocus
            value={value}
            placeholder={ui.placeholder ?? "입력…"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send({ value });
            }}
          />
        )}
        {ui.method === "editor" && (
          <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={8} />
        )}
        {ui.method === "select" && (
          <div className="modal-options">
            {(ui.options ?? []).map((opt) => (
              <button key={opt} className="btn" onClick={() => send({ value: opt })}>
                {opt}
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          {ui.method === "confirm" ? (
            <>
              <button className="btn danger" onClick={() => send({ confirmed: false })}>
                거부
              </button>
              <button className="btn primary" onClick={() => send({ confirmed: true })}>
                확인
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => send({ cancelled: true })}>
                취소
              </button>
              {ui.method !== "select" && (
                <button className="btn primary" onClick={() => send({ value })}>
                  확인
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
