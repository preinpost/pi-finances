# pi-naver-news

[네이버 뉴스 검색 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-news) 클라이언트 pi 패키지 — 한국 증권·종목 뉴스 검색.

REST 직접 호출(의존성 0, MCP 서버 없음). 인증은 **NAVER API HUB** 키(API Key ID/Secret 헤더).

> ⚠️ **2026-07-31부터 네이버 개발자센터의 Search API 신규 신청이 종료**되어
> 신규 키는 모두 **NAVER API HUB** (네이버클라우드)에서 발급합니다.
> 기존 개발자센터 키는 `legacy` 모드로 2027-06-30까지 사용 가능합니다.

## 설치

```bash
pi install npm:pi-naver-news
# pi 재시작
```

## 사용

```bash
# pi 안에서:
/naver-news-key      # API Key ID / API Key 등록 (기본 hub 모드 — NAVER API HUB)
/naver-news-status   # 연동 상태 진단 (모드/키/백엔드/레이트리밋/캐시/오늘 호출 수)

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

## 키 등록 (NAVER API HUB — 신규 기본)

1. [네이버클라우드 콘솔](https://console.ncloud.com/) 가입/로그인 (리전·플랫폼 선택 → 적용)
2. 메뉴 → 전체 서비스 → Application Services → **NAVER API HUB** 구독
   - 바로가기: https://console.ncloud.com/naver-api-hub/subscription
3. 콘솔에서 **Application 생성** → 발급된 **API Key ID / API Key** 확인
4. pi에서 `/naver-news-key` 실행 → 기본 **hub** 모드로 두 값 등록

### legacy 모드 (기존 개발자센터 키 보유자만)

2026-07-31 이전 발급 키가 있으면 `/naver-news-key`에서 모드에 `legacy` 입력
(X-Naver-Client-Id/Secret, openapi.naver.com) — **2027-06-30까지**만 동작합니다.

## 한도 (2026-08 현재)

- **HUB (기본)**: 월 775,000건 통합 / 키당 50 RPS — **현재 한시 무료, 향후 유료 예정**
- **legacy**: 하루 25,000회 (2027-06-30 종료)
- 기본 스로틀 **300ms** (~3.3 req/s) — `NAVER_NEWS_RATE_LIMIT_MULTIPLIER`로 배율 조정 (0이면 해제)
- TTL 캐시로 호출 절약: 검색 60s (`NAVER_NEWS_DISABLE_CACHE=1`로 비활성화)
- 401 = 키 오류 / 403 = 구독·Application 미생성 (또는 legacy에서 검색 API 미활성화) / 429 = 한도 초과

## 아키텍처

```
index.ts             — thin entry: export default registerExtension
src/
  cache.ts           TTL 메모리 캐시 (검색 60s, NAVER_NEWS_DISABLE_CACHE=1 비활성)
  client.ts          transport — 모드별 엔드포인트/헤더 (hub: naverapihub.apigw.ntruss.com
                     + X-NCP-APIGW-API-KEY-ID/KEY, legacy: openapi.naver.com + X-Naver-*)
                     + 레이트리밋 + 에러 매핑 (평면형/중첩형 오류 모두 파싱, 401/403/429)
  ratelimit.ts       promise-chain 레이트리밋 (기본 300ms, NAVER_NEWS_RATE_LIMIT_MULTIPLIER 배율)
                     + 호출 카운터 (자정 리셋, /naver-news-status에서 확인)
  secret.ts          pi-naver-news 전용 키 스토어 (mode: hub/legacy, mergeWrite,
                     env 폴백 NCP_APIGW_API_KEY_ID/KEY 또는 NAVER_CLIENT_ID/SECRET)
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
