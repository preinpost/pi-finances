/**
 * src/roles/status.ts — 시장 데이터 제공자 키 상태 (market_status 툴).
 *
 * 호출 시점의 env/스토어를 읽어 사용 가능한 브로커·데이터 제공자를 한 번에
 * 알려준다. 에이전트가 시세·차트 조회 전에 이 툴을 부르면, 설정되지 않은
 * 제공자의 *_price/*_chart 툴을 순차 시도하며 실패하는 낭비를 피할 수 있다.
 *
 * 키 소스:
 *  - 컨테이너 모델: env가 유일 (docker-entrypoint.sh가 스토어 파일을 제거).
 *  - 로컬 pi: KIS는 loadKeys()로 스토어+env를 모두 확인. 타 제공자(토스·twelve·
 *    finnhub·coingecko·naver)는 스토어가 패키지별 분리되어 있어 env만 확인
 *    (모든 패키지가 env 폴백을 지원하므로 컨테이너/CI 기준으로 충분).
 */
import { loadKeys } from "../auth.ts";

export interface ProviderStatus {
	id: string;
	label: string;
	configured: boolean;
	/** 설정 시 사용 가능한 툴 (prefix_name 규칙 접두사). */
	tools: string[];
	note?: string;
}

const has = (k: string) => Boolean(process.env[k]?.trim());
const hasPair = (a: string, b: string) => has(a) && has(b);

/** 네이버 뉴스 모드 — env(NAVER_NEWS_API_MODE) 우선, 기본 hub. */
export function naverNewsMode(): "hub" | "legacy" {
	return (process.env.NAVER_NEWS_API_MODE ?? "hub").trim().toLowerCase() === "legacy" ? "legacy" : "hub";
}

/** 사용 가능한 데이터 제공자 목록 (설정 여부 포함). */
export function providerStatuses(): ProviderStatus[] {
	const kis = loadKeys();
	const naverMode = naverNewsMode();
	const naverConfigured =
		naverMode === "legacy"
			? hasPair("NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET")
			: hasPair("NCP_APIGW_API_KEY_ID", "NCP_APIGW_API_KEY");
	return [
		{
			id: "kis-real",
			label: "KIS 실전",
			configured: Boolean(kis.appKey),
			tools: ["kis_domestic_price", "kis_overseas_price", "kis_technical", "kis_research", "kis_realtime", "broker_price", "broker_chart"],
			note: "국내외 시세·차트·리서치·실시간·주문",
		},
		{
			id: "kis-paper",
			label: "KIS 모의",
			configured: Boolean(kis.paperAppKey),
			tools: ["kis_* (env=paper)"],
			note: "모의투자",
		},
		{
			id: "toss",
			label: "토스증권",
			configured: hasPair("TOSS_CLIENT_ID", "TOSS_CLIENT_SECRET"),
			tools: ["toss_price", "toss_chart", "toss_market", "toss_balance", "toss_order", "toss_conditional"],
			note: "국내외 시세·시장 데이터·주문·조건주문",
		},
		{
			id: "twelve",
			label: "Twelve Data",
			configured: has("TWELVE_API_KEY"),
			tools: ["twelve_price", "twelve_chart", "twelve_search", "twelve_exchange_rate"],
			note: "전 세계 시세·차트·검색·환율",
		},
		{
			id: "finnhub",
			label: "Finnhub",
			configured: has("FINNHUB_API_KEY"),
			tools: ["finnhub_price", "finnhub_chart", "finnhub_news", "finnhub_fundamentals"],
			note: "미국 주식 시세·차트·뉴스·펀더멘털",
		},
		{
			id: "coingecko",
			label: "CoinGecko",
			configured: has("COINGECKO_API_KEY"),
			tools: ["coingecko_price", "coingecko_chart", "coingecko_market", "coingecko_coin", "coingecko_search"],
			note: "암호화폐",
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

/** market_status 툴 출력용 마크다운 요약. */
export function providerStatusSummary(): string {
	const providers = providerStatuses();
	const configured = providers.filter((p) => p.configured);
	const missing = providers.filter((p) => !p.configured);
	const lines = [
		"## 시장 데이터 제공자 상태",
		"",
		`**설정됨**: ${configured.map((p) => p.label).join(", ") || "없음"}`,
		`**미설정**: ${missing.map((p) => p.label).join(", ") || "없음"}`,
		"",
		"| 제공자 | 상태 | 사용 가능 툴 |",
		"|---|---|---|",
		...providers.map(
			(p) => `| ${p.label} | ${p.configured ? "✅ 설정됨" : "❌ 미설정"} | ${p.configured ? p.tools.join(", ") : "(미설정 — 호출 금지)"} |`,
		),
		"",
		"규칙: 미설정 제공자의 `*_price`/`*_chart` 툴은 호출해도 실패하므로 시도하지 말 것. " +
			"시세/차트는 `broker_price`/`broker_chart` 우선 (KIS 우선, 실패 시 응답의 fallback 지시를 이어서 수행).",
	];
	return lines.join("\n");
}
