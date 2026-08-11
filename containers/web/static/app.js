/* pi 금융분석 웹챗 — 최소 챗 UI (Phase 3a, vanilla JS, 의존성 0) */
"use strict";
(() => {
  const messagesEl = document.getElementById("messages");
  const form = document.getElementById("composer");
  const input = document.getElementById("input");
  const connEl = document.getElementById("conn");
  const statusEl = document.getElementById("status");

  const state = { currentMsg: null, textByIndex: new Map() };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text) {
    const row = el("div", "msg " + role);
    const bubble = el("div", "bubble", text);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setConn(ok, label) {
    connEl.className = "conn " + (ok ? "online" : "offline");
    connEl.textContent = label;
  }

  // assistant 메시지에서 순수 텍스트만 추출 (thinking/toolCall 제외)
  function extractText(m) {
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
    }
    return "";
  }

  // ── SSE 이벤트 처리 ────────────────────────────────────────────────
  function handleEvent(evt) {
    switch (evt.type) {
      case "agent_start":
        setStatus("분석 중…");
        break;
      case "agent_settled":
        setStatus("완료");
        break;
      case "message_start": {
        const m = evt.message;
        if (m && m.role === "assistant") {
          state.currentMsg = addMessage("assistant", "");
          state.textByIndex = new Map();
        }
        break;
      }
      case "message_update": {
        const a = evt.assistantMessageEvent;
        if (!a || !state.currentMsg) break;
        if (a.type === "text_start") {
          state.textByIndex.set(a.contentIndex, "");
        } else if (a.type === "text_delta") {
          const cur = state.textByIndex.get(a.contentIndex) || "";
          state.textByIndex.set(a.contentIndex, cur + a.delta);
          state.currentMsg.textContent = [...state.textByIndex.values()].join("");
          scrollToBottom();
        }
        // thinking_* / toolcall_* 델타는 3a에서 무시 (3b에서 렌더링)
        break;
      }
      case "message_end": {
        const m = evt.message;
        if (m && m.role === "assistant" && state.currentMsg) {
          const text = extractText(m);
          if (text) state.currentMsg.textContent = text;
          state.currentMsg = null;
          state.textByIndex.clear();
          scrollToBottom();
        }
        break;
      }
      case "tool_execution_start": {
        setStatus(`툴 실행: ${evt.toolName || "tool"}`);
        break;
      }
      case "extension_ui_request":
        // 3b에서 confirm/input/editor 모달로 렌더링 — 지금은 로그만
        console.log("[3a] extension_ui_request:", evt.method, evt.title, evt.id);
        setStatus(`요청 대기: ${evt.title || evt.method} (3b에서 모달)`);
        break;
      case "status":
        if (evt.state === "respawned") setStatus("RPC 연결됨 (재시작)");
        else if (evt.state === "exited") setStatus("RPC 종료 — 재시작 대기 중…");
        break;
      default:
        break;
    }
  }

  // ── 전송 ───────────────────────────────────────────────────────────
  async function send() {
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    addMessage("user", message);
    setStatus("전송 중…");
    try {
      const resp = await fetch("/api/cmd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "prompt", payload: { message } }),
      });
      const data = await resp.json();
      if (!resp.ok) setStatus("오류: " + (data.error || "전송 실패"));
      else if (data.success === false) setStatus("거부됨: " + (data.error || ""));
      else setStatus("접수됨");
    } catch (err) {
      setStatus("네트워크 오류: " + err.message);
    }
  }

  // ── 이벤트 연결 ────────────────────────────────────────────────────
  const es = new EventSource("/api/stream");
  es.onopen = () => setConn(true, "연결됨");
  es.onerror = () => setConn(false, "연결 끊김 (자동 재시도)");
  es.onmessage = (e) => {
    let evt;
    try {
      evt = JSON.parse(e.data);
    } catch {
      return;
    }
    handleEvent(evt);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // 초기 상태 + RPC 준비 확인
  setStatus("준비 — RPC 연결 대기 중");
  fetch("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "get_state" }),
  })
    .then((r) => r.json())
    .then((d) => {
      if (d.success) {
        setStatus("연결됨 — 분석 요청을 입력하세요");
        setConn(true, "연결됨");
      }
    })
    .catch(() => {});
})();
