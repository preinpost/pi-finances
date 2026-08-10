/**
 * src/agent/tools.ts — pi 툴 등록 (naver_news_search — 네이버 검색 API 뉴스).
 *
 * 모든 응답은 roles/naver-news.ts에서 정규화 후
 * jsonResult({ ok: true, ... }) — 실패 시 jsonResult({ ok: false, error }).
 * execute 내부는 roles/naver-news.ts로 위임.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { searchNews } from "../roles/naver-news.ts";

/** 툴 결과 공통 래퍼 — { ok, ... } JSON 문자열. */
export function jsonResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: {} };
}

export function registerTools(pi: ExtensionAPI): void {
	// ── naver-news: 키워드 뉴스 검색 ────────────────────────────────────
	pi.registerTool({
		name: "naver_news_search",
		label: "네이버 뉴스 검색",
		description:
			"네이버 검색 API(공식) 한국 뉴스 검색 — 종목명/종목코드/키워드로 증권·시장 뉴스 헤드라인+요약+URL 조회. " +
			"query: 검색어 (예: \"삼성전자\", \"005930\", \"코스피\", \"금리\"), " +
			"display: 표시 개수 (기본 10, 최대 100), start: 시작 위치 (기본 1, 최대 1000), " +
			"sort: sim=정확도순(기본)/date=최신순, days: 최근 N일 이내만 필터 (기본 7 — API에 날짜 필터가 없어 클라이언트 필터, 0=전체). " +
			"제목/요약의 <b> 하이라이트와 HTML 엔티티는 제거되어 전달됩니다. " +
			"키 등록은 /naver-news-key (developers.naver.com 앱 등록 → 검색 API 활성화 필수, 하루 25,000회).",
		parameters: Type.Object({
			query: Type.String({ description: "검색어 — 종목명·종목코드·키워드, 예: 삼성전자 / 005930 / 코스피" }),
			display: Type.Optional(Type.Number({ description: "표시 개수 (기본 10, 최대 100)" })),
			start: Type.Optional(Type.Number({ description: "검색 시작 위치 (기본 1, 최대 1000)" })),
			sort: Type.Optional(
				Type.Union(
					[
						Type.Literal("sim", { description: "정확도순" }),
						Type.Literal("date", { description: "최신순" }),
					],
					{ description: "정렬 (기본 sim)" },
				),
			),
			days: Type.Optional(Type.Number({ description: "최근 N일 이내만 필터 (기본 7, 0=필터 없음)" })),
		}),
		async execute(_id, params) {
			try {
				const result = await searchNews(
					{
						query: params.query,
						display: params.display,
						start: params.start,
						sort: params.sort,
					},
					{ days: params.days ?? 7 },
				);
				if (result.items.length === 0) {
					return jsonResult({
						ok: true,
						source: "naver-news",
						...result,
						items: [],
						notice: result.total === 0 ? "검색 결과가 없습니다 — 검색어를 확인하세요." : "최근 N일 이내 기사가 없습니다 — days를 늘리거나 sort=sim으로 시도하세요.",
					});
				}
				return jsonResult({ ok: true, source: "naver-news", ...result });
			} catch (e) {
				return jsonResult({ ok: false, error: (e as Error).message });
			}
		},
	});
}
