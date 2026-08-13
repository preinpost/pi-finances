# 세션 시스템 프롬프트 관련 메모

## "시스템 프롬프트에 지시/규칙 추가" 요청이 오면

이 프로젝트의 pi 세션 시스템 프롬프트 주입은 **웹 서버 코드**에서 한다. (정적 `.pi/APPEND_SYSTEM.md` 사용 안 함 — 삭제됨)

- `containers/web/server/providerStatus.ts`
  - `providerStatusBlock(env)` — 데이터 제공자 키 상태 블록 (env 읽어서 주입)
  - `responseRulesBlock()` — 응답 규칙 블록 (도구 이름 미노출 지시)
- `containers/web/server/index.ts` — `createRuntime`의
  `resourceLoaderOptions.appendSystemPrompt: [providerStatusBlock(process.env), responseRulesBlock()]`

세션 생성 시점에 env 상태를 읽어 주입하므로, 지시 추가/수정은 여기 코드에서 한다.

## "도구 이름 노출하지 마라" 요청이 오면

이미 `responseRulesBlock()`에 구현되어 있다 — 응답 본문에 도구 이름(`kis_api`, `broker_price` 등)을 노출하지 않는 규칙.
