# pi-finances

finance용 **pi packages 모노레포** (pnpm workspace). 한국 투자·시장 데이터 관련 pi 패키지를
브로커/도메인 단위로 분리해 개발·배포한다.

## 패키지

| 패키지 | 내용 | 설치 |
|---|---|---|
| [pi-kis](packages/pi-kis) | 한국투자증권 OPEN API — 시세·차트·주문·리서치·파생·실시간 (338개 API 스펙) | `pi install npm:pi-kis` |
| [pi-toss](packages/pi-toss) | 토스증권 OPEN API — 시세·시장 데이터·자산·주문·조건주문 | `pi install npm:pi-toss` |
| [pi-finance-core](packages/pi-finance-core) | 공용 라이브러리 — 기술적 지표 + 범용 시크릿 스토어 (확장/스킬 없음) | 직접 설치 불필요 (자동 의존) |

- **pi-kis v0.3.0부터 토스증권이 pi-toss로 분리** — 두 브로커를 모두 쓰려면 두 패키지를
  모두 설치하세요. 키 저장소는 공용이라 재등록이 필요 없습니다.
- 향후 finance 패키지(스크리너·리포트·자산관리 등)도 `packages/*`에 추가 예정.

## 구조

```
packages/*           — npm 배포 단위 (각자 독립 버저닝·태그·publish)
tsconfig.base.json   — 공용 TS 설정 (Node 타입 스트리핑, 빌드 없음)
.github/workflows/   — bump-and-release (변경 패키지 감지 → pnpm publish, topo 순서)
```

## 개발

```bash
pnpm install        # 루트에서 1회 (workspace 링크 + 의존성)
pnpm typecheck      # 전체 패키지 타입체크 (tsc --noEmit)
```

로컬에서 pi에 바로 물려 테스트:

```bash
pi install /absolute/path/to/packages/pi-kis
pi install /absolute/path/to/packages/pi-toss
# (로컬 경로 설치는 소스를 그대로 로드 — 개발 중엔 설정 파일을 직접 수정해도 됨)
```

## 릴리스

main push/merge 시 커밋 메시지 기반(`BREAKING`/`feat`/`fix`)으로 **변경된 패키지만**
버전을 올리고 npm에 publish한다 (`pi-kis@x`, `pi-toss@y`, `pi-finance-core@z` 태그,
topological order: core → toss → kis). 워크플로: [bump-and-release.yml](.github/workflows/bump-and-release.yml).

> ⚠️ 모노레포 루트는 `pi` manifest가 없으므로 `pi install git:github.com/preinpost/pi-finances`는
> 동작하지 않는다 — 반드시 npm 레지스트리에서 설치할 것.
