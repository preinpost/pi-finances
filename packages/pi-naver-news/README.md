# pi-naver-news

[네이버 검색 API(뉴스)](https://developers.naver.com/docs/serviceapi/search/news/news.md) 공식 오픈API 클라이언트 pi 패키지 — 한국 증권·종목 뉴스 검색.

REST 직접 호출(의존성 0, MCP 서버 없음). 무료 — 하루 **25,000회** 한도. Client ID/Secret 헤더 인증.

## 설치

```bash
pi install npm:pi-naver-news
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/naver-news-key      # 네이버 Client ID / Client Secret 등록 (검색 API 활성화 필수)
/naver-news-status   # 연동 상태 진단 (키/백엔드/레이트리밋/캐시/오늘 호출 수)

# 그 다음 자연어로:
"삼성전자 최근 뉴스"              # naver_news_search (sort=date, 최근 7일)
"005930 관련 기사 정확도순 20개"   # naver_news_search (display=20, sort=sim)
"코스피 오늘 기사 없나?"           # naver_news_search (days=1)
```

## 도구

| 도구 | 설명 |
|---|---|
| `naver_news_search` | 한국 뉴스 검색 — query 필수, display(≤100)/start(≤1000)/sort(sim·date)/days(최근 N일 필터) |

> ⚠️ API에 날짜 필터가 없어 `days`는 클라이언트 필터입니다 (기본 7, 0=필터 없음).
> 제목/요약의 `<b>` 하이라이트와 HTML 엔티티는 제거되어 전달됩니다.

## 한도 (무료)

- 하루 **25,000회** (클라이언트 ID별 합산) — `/naver-news-status`에서 오늘 사용량 확인
- 기본 스로틀 **300ms** (~3.3 req/s) — `NAVER_NEWS_RATE_LIMIT_MULTIPLIER`로 배율 조정 (0이면 해제)
- TTL 캐시로 호출 절약: 검색 60s (`NAVER_NEWS_DISABLE_CACHE=1`로 비활성화)
- 401 = 키 오류 / 403 = **검색 API 미활성화** (개발자센터 → 내 애플리케이션 → API 설정 → 검색 체크)

## 키 등록

1. developers.naver.com 로그인 → [내 애플리케이션](https://developers.naver.com/apps/#/register) → 애플리케이션 등록
   - **API 설정에서 "검색"을 반드시 활성화** (안 하면 403)
2. 발급받은 **Client ID / Client Secret** → `/naver-news-key`로 등록 (OS 키체인 / 0600 파일 폴백)
   - 셸 env `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` 폴백 지원

## 아키텍처

```
index.ts             — thin entry: export default registerExtension
src/
  cache.ts           TTL 메모리 캐시 (검색 60s, NAVER_NEWS_DISABLE_CACHE=1 비활성)
  client.ts          네이버 transport — X-Naver-Client-Id/Secret 헤더 + 레이트리밋 + 에러 매핑(401/403/429)
  ratelimit.ts       promise-chain 레이트리밋 (기본 300ms, NAVER_NEWS_RATE_LIMIT_MULTIPLIER 배율)
                     + 일일 호출 카운터 (25,000회/일 한도 모니터링, 자정 리셋)
  secret.ts          pi-naver-news 전용 키 스토어 (mergeWrite — NAVER_CLIENT_ID/SECRET env 폴백)
  roles/             — 도메인 역할 (typed wrapper, 에이전트가 직접 import)
    naver-news.ts    검색 정규화 (decodeHtml: <b>·엔티티 제거, pubDate → ISO, days 필터)
  agent/             — pi 통합
    extension.ts     registerExtension
    tools.ts         naver_news_search 툴 (execute는 roles 위임)
    commands.ts      /naver-news-key, /naver-news-status
```

## 시크릿 저장소

namespace `pi-naver-news` (env 컨트롤은 공용 `KIS_SECRET_STORE`/`KIS_KEYS_FILE`).
백엔드 우선순위: OS 키체인(`@napi-rs/keyring`) → 0600 파일 폴백(`~/.pi/agent/pi-naver-news-keys.json`).
자세한 동작(적응형 폴백/마이그레이션)은 [pi-finance-core](https://github.com/preinpost/pi-finances/tree/main/packages/pi-finance-core) 참고.

## 개발

이 패키지는 [pi-finances](https://github.com/preinpost/pi-finances) 모노레포(pnpm workspace)의 일부입니다.

```bash
pnpm --filter pi-naver-news typecheck
pnpm --filter pi-naver-news exec node --experimental-transform-types scripts/smoke.mjs
```
