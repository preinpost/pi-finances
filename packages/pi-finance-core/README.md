# pi-finance-core

pi-finances 모노레포의 공용 라이브러리 — 브로커(KIS/토스 등)에 중립적인 순수 모듈.

확장(`pi` manifest)이나 스킬이 없는 **라이브러리 전용** 패키지다.
`pi-kis` / `pi-toss` 및 향후 finance 패키지들이 의존한다.

## 구성

| 모듈 | 내용 |
|---|---|
| `src/store.ts` | 범용 시크릿 스토어 — OS keyring(우선) / 파일(폴백) 적응형, 네임스페이스 스코프. `mergeWrite`로 타 패키지 필드 보존 |
| `src/indicators.ts` | 기술적 지표 — `Bar`, MA/RSI/ATR/볼린저/지지저항/추세 (`analyze`) |
| `skills/timing` | 공용 스킬 — 매수/매도 타점 분석 (차트 툴은 설치된 브로커 기준: kis_technical/toss_chart) |

## 스킬 번들링 (중요)

core는 pi manifest로 `skills`를 선언한다. **직접 `pi install`하지 않고**, pi-kis가
`bundledDependencies`로 tarball에 번들해 `node_modules/pi-finance-core/skills` 경로로
로드한다 (pi 문서의 리소스 공유 패턴).

⚠️ pi의 스킬 로더는 **경로 기준 dedup**만 한다 — 번들로 생긴 물리적으로 다른 복사본은
내용이 같아도 같은 이름이면 충돌로 보고 `[Skill conflicts]` 경고를 낸다. 따라서 공용
스킬 등록은 **pi-kis 단독**이 담당하고, pi-toss는 모듈 번들만 유지한 채 `pi.skills`
등록을 하지 않는다 (pi-toss 단독 설치는 `toss_chart`로 직접 분석).

## 시크릿 스토어 (중요)

pi-kis와 pi-toss는 **하나의 공유 네임스페이스**(`pi-kis`)를 사용한다.
분리 이전부터 두 브로커의 키가 같은 저장소에 있었으므로, 네임스페이스를
유지하면 기존 사용자의 키가 그대로 유효하다 (재입력/마이그레이션 불필요).

- keyring SERVICE: `pi-kis` / 파일: `~/.pi/agent/kis-keys.json`(0600)
- env: `KIS_SECRET_STORE=file|keyring` 강제, `KIS_KEYS_FILE` 경로 오버라이드
- 각 패키지는 자체 타입드 뷰로 `read`/`mergeWrite`만 사용 — 전체 교체
  (`write`) 시 타 패키지 필드가 지워질 수 있으므로 금지

## 설치

```bash
pnpm add pi-finance-core   # 또는 워크스페이스: pnpm add pi-finance-core --filter pi-kis
```

Node >= 22.6 (타입 스트리핑으로 `.ts`를 직접 import).
