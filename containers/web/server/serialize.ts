import type { UIChartCard, UIChartTemplate, UIContentBlock, UIMessage } from "../shared/protocol.ts";
import { sanitizeAssistantText } from "./thinkingText.ts";

type AnyMessage = {
  role: string;
  content?: unknown;
  errorMessage?: string;
  toolCallId?: string;
  isError?: boolean;
  [key: string]: unknown;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(d: string): string {
  const s = d.replace(/[-/]/g, "").slice(0, 8);
  return /^\d{8}$/.test(s) ? s : "";
}

function barsFromRows(rows: unknown): UIChartCard["bars"] {
  if (!Array.isArray(rows)) return [];
  const bars: UIChartCard["bars"] = [];
  for (const row of rows.slice(0, 200)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = normalizeDate(String(r.date ?? r.stck_bsop_date ?? r.xymd ?? ""));
    const open = num(r.open ?? r.stck_oprc);
    const high = num(r.high ?? r.stck_hgpr);
    const low = num(r.low ?? r.stck_lwpr);
    const close = num(r.close ?? r.stck_clpr ?? r.clos);
    if (!date || open === null || high === null || low === null || close === null) continue;
    bars.push({ date, open, high, low, close, volume: num(r.volume ?? r.acml_vol ?? r.tvol) ?? undefined });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return bars;
}

function cardFromBars(
  symbol: string,
  name: string,
  period: string,
  bars: UIChartCard["bars"],
): UIChartCard | undefined {
  if (bars.length === 0) return undefined;
  const uniqueDays = new Set(bars.map((b) => b.date)).size;
  if (bars.length > 20 && uniqueDays * 3 < bars.length) return undefined;
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : undefined;
  const change = prev ? last.close - prev.close : 0;
  const changePct = prev && prev.close !== 0 ? (change / prev.close) * 100 : 0;
  return {
    kind: "chart-card",
    meta: {
      name: name || symbol || "",
      symbol,
      period: period || "일봉",
      price: last.close,
      change,
      changePct,
    },
    bars,
  };
}

function parseChartFromToolText(text: string): UIChartCard | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  const data = o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : o;
  let bars = barsFromRows(o.bars);
  if (bars.length === 0) bars = barsFromRows(data.output2);
  if (bars.length === 0) bars = barsFromRows(data.output1);
  if (bars.length === 0) return undefined;
  const summary = data.output1;
  const nameFromKis =
    summary && typeof summary === "object" && !Array.isArray(summary)
      ? String((summary as Record<string, unknown>).hts_kor_isnm ?? "")
      : "";
  return cardFromBars(
    String(o.symbol ?? o.symb ?? o.id ?? ""),
    String(o.name ?? nameFromKis),
    String(o.period ?? o.interval ?? o.resolution ?? "일봉"),
    bars,
  );
}

function parseChartCard(details: unknown): UIChartCard | undefined {
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  if (d.kind !== "chart-card" || !Array.isArray(d.bars) || d.bars.length === 0) return undefined;
  const metaIn = d.meta && typeof d.meta === "object" ? (d.meta as Record<string, unknown>) : {};
  const price = num(metaIn.price);
  const change = num(metaIn.change);
  const changePct = num(metaIn.changePct);
  if (price === null || change === null || changePct === null) return undefined;
  const bars: UIChartCard["bars"] = [];
  for (const row of d.bars.slice(0, 200)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "");
    const open = num(r.open);
    const high = num(r.high);
    const low = num(r.low);
    const close = num(r.close);
    if (!date || open === null || high === null || low === null || close === null) continue;
    const volume = num(r.volume) ?? undefined;
    bars.push({ date, open, high, low, close, volume });
  }
  if (bars.length === 0) return undefined;
  const template = parseTemplate(d.template ?? metaIn.template);
  return {
    kind: "chart-card",
    ...(template ? { template } : {}),
    meta: {
      name: String(metaIn.name ?? metaIn.symbol ?? ""),
      symbol: String(metaIn.symbol ?? ""),
      period: String(metaIn.period ?? "일봉"),
      price,
      change,
      changePct,
    },
    bars,
  };
}

const TEMPLATES: readonly UIChartTemplate[] = [
  "candle",
  "rsi",
  "ichimoku",
  "bollinger",
  "macd",
  "stochastic",
  "atr",
  "drawdown",
  "adx",
];

function parseTemplate(v: unknown): UIChartTemplate | undefined {
  return typeof v === "string" && (TEMPLATES as readonly string[]).includes(v)
    ? (v as UIChartTemplate)
    : undefined;
}

function parseCharts(details: unknown, text: string): UIChartCard[] {
  if (details && typeof details === "object") {
    const d = details as Record<string, unknown>;
    if (d.kind === "chart-cards" && Array.isArray(d.cards)) {
      return d.cards
        .map((c) => parseChartCard({ ...(typeof c === "object" && c ? c : {}), kind: "chart-card" }))
        .filter((c): c is UIChartCard => Boolean(c));
    }
    const templates = Array.isArray(d.templates) ? d.templates : null;
    const base = parseChartCard(details);
    if (base && templates && templates.length > 0) {
      return templates
        .map(parseTemplate)
        .filter((t): t is UIChartTemplate => Boolean(t))
        .map((template) => ({ ...base, template }));
    }
    if (base) return [base];
  }
  const fromText = parseChartFromToolText(text);
  return fromText ? [fromText] : [];
}

function requestedTemplates(userText: string): UIChartTemplate[] {
  const t = userText.trim();
  if (!t) return [];
  if (/다\s*보여|전부\s*다|모두\s*다|다\s*줘/.test(t)) {
    return ["rsi", "ichimoku", "bollinger"];
  }
  const out: UIChartTemplate[] = [];
  if (/rsi/i.test(t) || /상대\s*강도/.test(t)) out.push("rsi");
  if (/일목|ichimoku/i.test(t)) out.push("ichimoku");
  if (/볼린저|bollinger/i.test(t)) out.push("bollinger");
  if (/macd/i.test(t)) out.push("macd");
  if (/스토캐스틱|stoch/i.test(t)) out.push("stochastic");
  if (/\batr\b/i.test(t) || /평균\s*진폭/.test(t)) out.push("atr");
  if (/낙폭|drawdown/i.test(t)) out.push("drawdown");
  if (/\badx\b/i.test(t) || /추세\s*강도/.test(t)) out.push("adx");
  return out;
}

function lastUserText(msgs: AnyMessage[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return textFromContent(msgs[i].content);
  }
  return "";
}

function applyRequestedTemplates(charts: UIChartCard[], userText: string): UIChartCard[] {
  const extras = requestedTemplates(userText);
  if (extras.length === 0 || !charts[0]) return charts;
  const have = new Set(charts.map((c) => c.template ?? "candle"));
  if (extras.every((t) => have.has(t))) return charts;
  return extras.map((template) => ({ ...charts[0], template }));
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
  }
  return "";
}

/**
 * pi의 AgentMessage[] 를 UI용 메시지로 변환.
 * toolResult 메시지는 해당 toolCall 블록에 페어링해서 합친다.
 */
export function serializeMessages(messages: unknown[]): UIMessage[] {
  const msgs = messages as AnyMessage[];

  // toolCallId -> result 매핑
  let lastUserIdx = -1;
  let userText = "";
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === "user") {
      lastUserIdx = i;
      userText = textFromContent(msgs[i].content);
    }
  }
  const results = new Map<string, { text: string; isError: boolean; chart?: UIChartCard; charts?: UIChartCard[] }>();
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "toolResult" && typeof m.toolCallId === "string") {
      const text = textFromContent(m.content);
      let charts = parseCharts(m.details, text);
      if (i > lastUserIdx) charts = applyRequestedTemplates(charts, userText);
      results.set(m.toolCallId, {
        text,
        isError: m.isError === true,
        ...(charts[0] ? { chart: charts[0], charts } : {}),
      });
    }
  }

  const out: UIMessage[] = [];
  for (const m of msgs) {
    if (m.role === "toolResult") continue; // toolCall에 합쳐짐

    if (m.role === "user") {
      const blocks: UIContentBlock[] = [];
      if (typeof m.content === "string") {
        blocks.push({ type: "text", text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const b of m.content as { type: string; text?: string; data?: string; mimeType?: string }[]) {
          if (b.type === "text" && b.text) blocks.push({ type: "text", text: b.text });
          else if (b.type === "image") {
            blocks.push({
              type: "image",
              dataUrl:
                b.data && b.mimeType ? `data:${b.mimeType};base64,${b.data}` : undefined,
            });
          }
        }
      }
      if (blocks.length > 0) out.push({ role: "user", content: blocks });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: UIContentBlock[] = [];
      if (Array.isArray(m.content)) {
        for (const b of m.content as Record<string, unknown>[]) {
          if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
            const text = sanitizeAssistantText(b.text);
            if (text) blocks.push({ type: "text", text });
          } else if (b.type === "thinking") {
            continue; // 사고 토큰은 웹챗에 노출하지 않는다
          } else if (b.type === "toolCall") {
            const id = String(b.id ?? "");
            blocks.push({
              type: "toolCall",
              id,
              name: String(b.name ?? "unknown"),
              args: b.arguments,
              result: results.get(id),
            });
          }
        }
      }
      if (blocks.length > 0 || m.errorMessage) {
        out.push({
          role: "assistant",
          content: blocks,
          errorMessage: typeof m.errorMessage === "string" ? m.errorMessage : undefined,
        });
      }
      continue;
    }

    // custom/기타 메시지: 텍스트가 있으면 표시
    const text = textFromContent(m.content);
    if (text) out.push({ role: "custom", content: [{ type: "text", text }] });
  }

  return out;
}
