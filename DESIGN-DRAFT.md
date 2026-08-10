# pi-finances 모노레포 설계 초안 (review 대상)

## 목표
`../pi-kis`(KIS + Toss 브로커가 합쳐진 pi 패키지)를 `pi-finances`로 옮기고,
앞으로 여러 finance용 pi packages를 찍어낼 수 있는 pnpm 모노레포로 만든다.

## 현재 pi-kis 구조 (v0.2.1, npm 배포 중, 사용자 ~/.pi/agent에 `npm:pi-kis` 설치됨)
- src/core/ — REST/WS/인증/시크릿(keyring), KIS API 스펙 338개 (configs/*.json ~400KB)
- src/core/toss/ — 토스 OAuth client + ratelimit (이미 분리됨)
- src/roles/ — market/portfolio/trading/research/derivatives/greeks(→KIS), toss(→토스), broker(중립 퍼사드+폴백), indicators(공용), types(공용)
- src/agent/ — extension.ts + tools.ts (kis_* 10 + toss_* 7 + broker_* 2) + commands.ts (/kis-key /toss-key /kis-status /kis-watch)
- src/watch.ts — /kis-watch 엔진 (KIS 실시간)
- skills/ — kis-trading, stock-research, sector-research, timing, stock-html(범용 리포트 HTML)
- release: .github/workflows/bump-and-release.yml (커밋메시지 기반 버전 + npm publish, 단일 패키지 전제, npm ci 사용)

## 제안 구조
```
pi-finances/ (pnpm workspace, packages/*)
├── packages/pi-kis/          # KIS 전용 (기존 이름 유지, 0.3.0에서 toss 제거 = breaking)
├── packages/pi-toss/         # 토스 전용 (core/toss + roles/toss + toss_* 7 + /toss-key)
├── packages/pi-finance-core/ # 공용 lib: indicators/Bar, types, 시크릿 저장소(keyring), ratelimit
└── (향후) pi-stock-html, pi-screener, ... (여러 finance 패키지)
```

## 핵심 설계 결정 (검토 포인트)
1. **kis/toss 분리 시점**: 지금 분리 (코드상 이미 분리됨, 독립 버저닝, toss-only 사용자가 400KB KIS configs 안 받음)
2. **broker_* 폴백 퍼사드 운명**: pi는 패키지별 module root 분리 — 설치된 pi-toss를 pi-kis가 런타임 import 불가.
   (a) pi-kis가 pi-toss를 optionalDependency로 갖고 동적 import (모노레포 dev에선 workspace:*, 배포판에선 npm 의존)
   (b) 퍼사드 폐기 — 에이전트가 kis_*/toss_* 중 키 있는 쪽을 골라 호출 (실패 시 다른 브로커 재시도)
3. **공용 키 저장**: secret.ts가 appKey + tossClientId를 한 파일에 보관 중 → core에 범용 keyring 스토어 API를 두고 각 패키지가 자체 키 스키마 정의
4. **skills 소유권**: kis-trading/stock-research/sector-research → pi-kis, timing → pi-kis(toss_market warnings 참조는 조건부), stock-html → pi-finance-core(범용)
5. **릴리스**: 기존 bump-and-release 커스텀 워크플로를 변경된 packages/* 감지(pnpm -r publish --filter)로 확장 vs changesets 도입
6. **git 히스토리**: git subtree로 이관(히스토리 보존) vs 새로 시작
7. **로컬 dev**: 사용자 ~/.pi/agent의 npm:pi-kis를 로컬 경로 설치(pi install ./packages/pi-kis)로 교체

## 제약 (pi 패키지 문서에서 확인됨)
- pi는 패키지를 "separate module roots"로 로드 — 패키지 간 런타임 import는 의존성으로 선언+설치돼야 함
- 다른 pi 패키지는 tarball에 bundledDependencies로 포함 권장 (리소스 보유 시)
- engine node >=18, 현재 코드는 .ts 확장자 import (Node 타입 스트리핑) — 빌드 스텝 없음
