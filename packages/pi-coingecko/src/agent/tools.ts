/**
 * src/agent/tools.ts — pi 툴 등록 (coingecko_* 5개 — CoinGecko 공식 API).
 *
 * 모든 응답은 roles/coingecko.ts에서 compact 정규화 후
 * jsonResult({ ok: true, ... }) — 실패 시 jsonResult({ ok: false, error }).
 * execute 내부는 roles/coingecko.ts로 위임.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyze, chartCardDetails } from "pi-finance-core";
import { getCoin, getMarkets, getOhlc, getPrices, searchCoins } from "../roles/coingecko.ts";

/** 툴 결과 공통 래퍼 — { ok, ... } JSON 문자열. */
export function jsonResult(value: unknown, details: object = {}) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details };
}

export function registerTools(pi: ExtensionAPI): void {
	// ── coingecko: 현재가 ─────────────────────────────────────────────────
	pi.registerTool({
		name: "coingecko_price",
		label: "코인게코 현재가",
		description:
			"CoinGecko 현재가 조회 — ids: 코인 **id** 콤마 구분 (최대 10, 심볼 아님 — id 확인은 coingecko_search), " +
			"vsCurrencies: 표시 통화 콤마 구분 (기본 usd,krw, 최대 5). " +
			"응답: [{ id, prices: { usd: { price, change24h, marketCap }, ... } }]. " +
			"Demo 키 없이도 공개 API 사용 가능 (5~15 req/min) — 키 등록은 /coingecko-key.",
		parameters: Type.Object({
			ids: Type.String({ description: "코인 id 콤마 구분 (최대 10), 예: bitcoin,ethereum" }),
			vsCurrencies: Type.Optional(Type.String({ description: "표시 통화 콤마 구분 (기본 usd,krw, 최대 5), 예: usd,krw" })),
		}),
		async execute(_id, params) {
			try {
				const ids = params.ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
				if (ids.length === 0) return jsonResult({ ok: false, error: "ids가 비어 있습니다." });
				const vsCurrencies = (params.vsCurrencies ?? "usd,krw")
					.split(",")
					.map((s) => s.trim().toLowerCase())
					.filter(Boolean)
					.slice(0, 5);
				if (vsCurrencies.length === 0) return jsonResult({ ok: false, error: "vsCurrencies가 비어 있습니다." });
				const prices = await getPrices(ids, vsCurrencies);
				return jsonResult({ ok: true, source: "coingecko", prices });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── coingecko: OHLC 차트 + 지표 ──────────────────────────────────────
	pi.registerTool({
		name: "coingecko_chart",
		label: "코인게코 차트·지표",
		description:
			"CoinGecko OHLC 차트 조회 후 공용 지표(MA/RSI/ATR/볼린저/지지저항/추세) 계산 — pi-finance-core indicators 동일 로직. " +
			"days: 1|7|14|30|90|180|365|max (기본 30). " +
			"⚠️ OHLC 데이터라 volume이 없어 거래량 지표는 제한적입니다. " +
			"응답: { ok, source, id, vsCurrency, days, barCount, lastBar, recentBars(최근 10봉), ...analyze }. " +
			"참고용 분석이며 투자 결정의 책임은 사용자에게 있습니다.",
		parameters: Type.Object({
			id: Type.String({ description: "코인 id, 예: bitcoin" }),
			vsCurrency: Type.Optional(Type.String({ description: "표시 통화 (기본 usd)" })),
			days: Type.Optional(
				Type.Union(
					[
						Type.Literal("1"),
						Type.Literal("7"),
						Type.Literal("14"),
						Type.Literal("30"),
						Type.Literal("90"),
						Type.Literal("180"),
						Type.Literal("365"),
						Type.Literal("max"),
					],
					{ description: "조회 기간 (기본 30)" },
				),
			),
		}),
		async execute(_id, params) {
			try {
				const days = params.days ?? "30";
				const { bars } = await getOhlc(params.id, params.vsCurrency ?? "usd", days);
				if (bars.length === 0) {
					return jsonResult({ ok: false, error: "차트 데이터 없음 — 코인 id를 확인하거나 days 값을 조정하세요." });
				}
				const card = days !== "1"
					? chartCardDetails({ symbol: params.id, period: days === "max" ? "전체" : `${days}일`, bars })
					: undefined;
				return jsonResult({
					ok: true,
					source: "coingecko",
					id: params.id,
					vsCurrency: params.vsCurrency ?? "usd",
					days,
					barCount: bars.length,
					lastBar: bars[bars.length - 1],
					recentBars: bars.slice(-10),
					...analyze(bars),
				}, card ?? {});
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── coingecko: 시장 랭킹 ─────────────────────────────────────────────
	pi.registerTool({
		name: "coingecko_market",
		label: "코인게코 시장 랭킹",
		description:
			"CoinGecko 시장 랭킹 조회 (usd 기준) — order: market_cap_desc(기본)/volume_desc/gecko_desc/gecko_asc, " +
			"perPage: 1~50 (기본 20). " +
			"응답: [{ id, symbol, name, current_price, market_cap, market_cap_rank, total_volume, price_change_percentage_24h, circulating_supply, max_supply }]. " +
			"캐시 2분 — 더 최신 시세는 coingecko_price(15s 캐시) 사용.",
		parameters: Type.Object({
			order: Type.Optional(
				Type.Union(
					[
						Type.Literal("market_cap_desc"),
						Type.Literal("volume_desc"),
						Type.Literal("gecko_desc"),
						Type.Literal("gecko_asc"),
					],
					{ description: "정렬 기준 (기본 market_cap_desc)" },
				),
			),
			perPage: Type.Optional(Type.Number({ description: "페이지당 코인 수 (기본 20, 최대 50)" })),
		}),
		async execute(_id, params) {
			try {
				const perPage = Math.min(Math.max(Math.round(params.perPage ?? 20), 1), 50);
				const coins = await getMarkets(params.order ?? "market_cap_desc", perPage);
				return jsonResult({ ok: true, source: "coingecko", order: params.order ?? "market_cap_desc", perPage, coins });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── coingecko: 코인 상세 ─────────────────────────────────────────────
	pi.registerTool({
		name: "coingecko_coin",
		label: "코인게코 코인 상세",
		description:
			"CoinGecko 코인 상세 조회 (market_data — usd 기준만 pick). id: 코인 id, 예: bitcoin. " +
			"응답: { id, symbol, name, market_cap_rank, current_price, market_cap, total_volume, high_24h, low_24h, ath, atl, " +
			"price_change_percentage_24h/7d/30d/1y, circulating_supply, max_supply }. " +
			"캐시 10분.",
		parameters: Type.Object({
			id: Type.String({ description: "코인 id, 예: bitcoin" }),
		}),
		async execute(_id, params) {
			try {
				const coin = await getCoin(params.id);
				return jsonResult({ ok: true, source: "coingecko", coin });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});

	// ── coingecko: 코인 검색 ─────────────────────────────────────────────
	pi.registerTool({
		name: "coingecko_search",
		label: "코인게코 코인 검색",
		description:
			"CoinGecko 코인 검색 — query로 코인의 정확한 **id**를 찾는 용도 (심볼은 중복될 수 있어 coingecko_* 툴은 id를 요구). " +
			"응답: [{ id, name, symbol, market_cap_rank }] 최대 10개. 캐시 10분.",
		parameters: Type.Object({
			query: Type.String({ description: "검색어, 예: bitcoin 또는 btc" }),
		}),
		async execute(_id, params) {
			try {
				const coins = await searchCoins(params.query);
				return jsonResult({ ok: true, source: "coingecko", query: params.query, coins });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});
}
