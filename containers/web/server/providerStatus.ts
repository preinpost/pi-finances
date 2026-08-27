/**
 * server/providerStatus.ts — 시장 데이터 제공자 키 상태 · 응답 규칙 (세션 시스템 프롬프트 주입용).
 *
 * 웹챗 서버가 세션을 생성할 때 process.env(=.env 파일 저장 포함 런타임 반영)를 읽어
 * "데이터 제공자 키 상태" 블록을 만들어 resourceLoaderOptions.appendSystemPrompt로
 * 에이전트 시스템 프롬프트에 주입한다. 에이전트가 미설정 브로커의 *_price/*_chart
 * 툴을 순차 시도하며 실패하는 낭비를 막는 것이 목적.
 *
 * 서버 전용 모듈 (process.env 사용) — 클라이언트에서 import 금지.
 */

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** 설정 시 사용 가능한 툴 (prefix_name 규칙 접두사). */
  tools: string[];
  note?: string;
}

const has = (env: NodeJS.ProcessEnv, k: string) => Boolean(env[k]?.trim());
const hasPair = (env: NodeJS.ProcessEnv, a: string, b: string) => has(env, a) && has(env, b);

export function naverNewsMode(env: NodeJS.ProcessEnv): "hub" | "legacy" {
  return (env.NAVER_NEWS_API_MODE ?? "hub").trim().toLowerCase() === "legacy" ? "legacy" : "hub";
}

/** 사용 가능한 데이터 제공자 목록 (설정 여부 포함) — pi-kis market_status 툴과 동일 규칙. */
export function providerStatuses(env: NodeJS.ProcessEnv): ProviderStatus[] {
  const naverMode = naverNewsMode(env);
  const naverConfigured =
    naverMode === "legacy"
      ? hasPair(env, "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET")
      : hasPair(env, "NCP_APIGW_API_KEY_ID", "NCP_APIGW_API_KEY");
  return [
    {
      id: "kis-real",
      label: "KIS 실전",
      configured: has(env, "KIS_APP_KEY") && has(env, "KIS_APP_SECRET"),
      tools: ["kis_domestic_price", "kis_overseas_price", "kis_technical", "kis_research", "kis_realtime", "broker_price", "broker_chart"],
      note: "국내외 시세·차트·리서치·실시간·주문",
    },
    {
      id: "kis-paper",
      label: "KIS 모의",
      configured: hasPair(env, "KIS_PAPER_APP_KEY", "KIS_PAPER_APP_SECRET"),
      tools: ["kis_* (env=paper)"],
      note: "모의투자",
    },
    {
      id: "toss",
      label: "토스증권",
      configured: hasPair(env, "TOSS_CLIENT_ID", "TOSS_CLIENT_SECRET"),
      tools: ["toss_price", "toss_chart", "toss_market", "toss_balance", "toss_order", "toss_conditional"],
      note: "국내외 시세·시장 데이터·주문·조건주문",
    },
    {
      id: "twelve",
      label: "Twelve Data",
      configured: has(env, "TWELVE_API_KEY"),
      tools: ["twelve_price", "twelve_chart", "twelve_search", "twelve_exchange_rate"],
      note: "전 세계 시세·차트·검색·환율",
    },
    {
      id: "finnhub",
      label: "Finnhub",
      configured: has(env, "FINNHUB_API_KEY"),
      tools: ["finnhub_price", "finnhub_chart", "finnhub_news", "finnhub_fundamentals"],
      note: "미국 주식 시세·차트·뉴스·펀더멘털",
    },
    {
      id: "coingecko",
      label: "CoinGecko",
      configured: has(env, "COINGECKO_API_KEY"),
      tools: ["coingecko_price", "coingecko_chart", "coingecko_market", "coingecko_coin", "coingecko_search"],
      note: "암호화폐",
    },
    {
      id: "binance",
      label: "Binance",
      configured: hasPair(env, "BINANCE_API_KEY", "BINANCE_API_SECRET"),
      tools: ["binance_price", "binance_chart", "binance_market", "binance_account", "binance_order", "binance_orders", "binance_orderlist", "binance_futures"],
      note: "현물·USDT-M 선물 (시세·차트는 키 없이 가능)",
    },
    {
      id: "naver-news",
      label: `네이버 뉴스 (${naverMode})`,
      configured: naverConfigured,
      tools: ["naver_news_search"],
      note: "한국 증권 뉴스",
    },
  ];
}

/** 세션 시스템 프롬프트에 주입할 응답 규칙 블록. */
export function responseRulesBlock(): string {
  return [
    "## 응답 규칙",
    "",
    "- 응답 본문에 도구(tool) 이름을 노출하지 않는다. (`kis_api로 조회했습니다`, `broker_price 호출 결과` 같은 표현 금지)",
    "- 도구 이름 대신 데이터 내용과 해석만 자연스럽게 전달한다. (예: \"현재가 기준으로 …\", \"최근 조회한 시세에 따르면 …\")",
    "- 응답 본문에 내부 추론·사고 과정·계획 독백을 쓰지 않는다. (`The user wants…`, `Let me check…`, `Wait,`, `Actually,`, `Hmm` 같은 혼잣말 금지)",
    "- 사고(thinking)는 thinking 채널로만 하고, 사용자에게는 결과와 다음 행동만 한국어로 전달한다.",
    "",
    "## 조회 습관 (런 안정성)",
    "",
    "- 여러 종목 시세는 가급적 한 번의 배치 호출(toss_price처럼 배열을 받는 툴) 또는 병렬 툴 호출로 묶는다. 단건 API를 종목당 한 번씩 수십 번 순차 호출하지 않는다.",
    "- 도구 호출 사이마다 사용자용 진행 서술(짧은 상태 문장)을 끼워 넣지 않는다. 조회 중 표시는 웹챗이 자동으로 그린다. 서술은 최종 답변에 모은다.",
    "- 일부 데이터 조회에 실패해도, 받아둔 데이터만으로 결론까지 완성된 답변으로 마무리한다. 실패한 항목은 '확인 불가'로 명시한다. 응답이 문장 중간에서 멈추면 런 오류다.",
    "",
    "## 차트",
    "",
    "- 차트를 보여달라는 요청에는 이미지 파일, matplotlib, HTML 생성, mermaid, xychart, ASCII를 쓰지 않는다.",
    "- 일봉 캔들은 `broker_chart` 또는 `broker_chart_card` 한 번만 호출한다. 웹챗이 카드를 그린다. 주봉은 사용자가 주봉을 원할 때만.",
    "- 「차트 보여줘」만 있으면 일봉 캔들 카드 다음에 이 문장만 붙인다: 「이 밖에 RSI, 일목균형표, 볼린저밴드를 같은 형식으로 보여드릴 수 있습니다. 원하는 종류를 말씀해 주세요.」 타점·표·시나리오는 하지 않는다.",
    "- RSI/볼린저/일목을 보여달라고 하면 `broker_chart_card` 또는 `kis_technical`에 kinds를 넣어 카드로 그린다. 텍스트 그림 금지.",
  ].join("\n");
}

/** 세션 시스템 프롬프트에 주입할 마크다운 블록. */
export function providerStatusBlock(env: NodeJS.ProcessEnv): string {
  const providers = providerStatuses(env);
  const configured = providers.filter((p) => p.configured);
  const missing = providers.filter((p) => !p.configured);
  return [
    "## 데이터 제공자 키 상태 (세션 시작 시점 자동 반영)",
    "",
    `**설정됨**: ${configured.map((p) => p.label).join(", ") || "없음"}`,
    `**미설정**: ${missing.map((p) => p.label).join(", ") || "없음"}`,
    "",
    "- 미설정 제공자의 `*_price` / `*_chart` 툴은 호출해도 실패하므로 순차 시도하지 말 것.",
    "- 시세·차트는 `broker_price` / `broker_chart` 를 우선 사용하고, 실패 시 응답의 fallback 지시를 따른다.",
    "- 실시간 상태 확인은 `market_status` 툴 호출.",
  ].join("\n");
}
