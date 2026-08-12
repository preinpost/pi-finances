---
name: pi-finances-release
description: pi-finances 모노레포(7개 pi-* npm 패키지 + Docker 컨테이너 GHCR) 배포·릴리스 절차. "배포", "릴리스", "배포하자", "publish", "npm에 올려", "버전 올려", "Docker 빌드", "GHCR" 등 요청 시 이 스킬의 절차를 따른다. 로컬 수동 npm publish 금지 — GitHub Actions가 담당.
---

# pi-finances 배포/릴리스

## 구조

- **npm 패키지 7개**: `packages/{pi-coingecko, pi-finance-core, pi-finnhub, pi-kis, pi-naver-news, pi-toss, pi-twelve-data}`
- **Docker 컨테이너**: `containers/` → `ghcr.io/preinpost/pi-finance` (amd64+arm64)

## 핵심 원칙

1. **로컬에서 수동 `npm publish` 금지** — GitHub Actions가 전담. 로컬 역할 = 작업·검증·커밋·푸시.
2. 패키지 워크플로우 `.github/workflows/release-<pkg>.yml` (7개 전부 동일 템플릿):
   `main` 푸시(`packages/<pkg>/**` 변경) 또는 `workflow_dispatch` →
   typecheck → 스모크 → **버전 범프(커밋 메시지 기반)** → `npm publish` → 태그 `pi-<pkg>@V` + GitHub Release
3. 컨테이너 워크플로우 `.github/workflows/release-pi-finance-container.yml`:
   **path 필터 없음** — main 푸시마다 `latest` 자동 갱신 / `v*` 태그 푸시 → semver 태그(`1.2.3`,`1.2`)+`latest`+Release / `workflow_dispatch` → 입력 tag (없으면 `sha-<short>`)

## 배포 절차 (전체 흐름)

```
작업 → 로컬 검증 → 커밋(Conventional) → main 푸시
  → npm 패키지 릴리스 자동 (패키지별 워크플로우)
  → (컨테이너 latest는 main 푸시마다 자동 갱신됨)
  → 버전 컨테이너 릴리스 필요 시 v1.2.3 태그 푸시
```

### 1단계 — 로컬 검증

```bash
pnpm --filter <pkg> typecheck
pnpm --filter <pkg> exec node --experimental-transform-types scripts/smoke.mjs   # 스모크 있는 패키지만 (pi-kis/pi-toss)
pnpm --filter <pkg> pack --dry-run    # files 필드에 src/skills/README 포함 확인
```

- 스킬/파일 추가 시 `package.json`의 `files`에 누락 없는지 반드시 확인 (예: pi-toss에 `skills` 추가했던 사례)
- 커밋 메시지 = **버전 결정** (Conventional Commits 필수):
  - `feat:` → minor / `BREAKING CHANGE` 또는 `!:` → major / 그 외(`fix:`·`docs:`·`chore:`) → patch
- 커밋 범위는 대상 패키지 파일로 한정 — path 필터가 형제 패키지 워크플로우를 오발동시키지 않게
- 문서·설정만 바꿀 때는 커밋 메시지에 **`[skip ci]`** 포함 → 불필요한 컨테이너 재빌드 방지
  (컨테이너 워크플로우는 path 필터가 없어 모든 main 푸시에 도는 데, `[skip ci]` 헤드 커밋은 스킵)

### 2단계 — 푸시 후 확인

```bash
gh run list --workflow release-<pkg>.yml --limit 3        # 또는 gh run watch
npm view <pkg> version                                    # 범프 확인 (예: pi-toss → 0.6.0)
gh release view pi-<pkg>@V                                # GitHub Release 확인
```

- 여러 패키지를 한 번에 배포: 패키지별 별도 커밋으로 순차 푸시 — 워크플로우가 `git pull --rebase`로 병렬 릴리스를 직렬화
- 수동 트리거: GitHub 웹 UI 또는 `gh workflow run release-<pkg>.yml -f bump=minor|patch|major|auto`
- 첫 릴리스(패키지 태그 없음): 범프 없이 현재 버전 그대로 publish
- 태그는 **publish 성공 후에만** 생성 (고아 태그 방지) — 실패 시 같은 커밋 재푸시하면 재시도

### 3단계 — Docker 컨테이너 (마지막 단계)

- main 최신 유지 중이면 `ghcr.io/preinpost/pi-finance:latest`는 이미 자동 갱신됨 → 별도 조치 불필요
- **버전 릴리스**: `git tag v1.2.3 && git push origin v1.2.3` → semver 태그 + latest + GitHub Release (digest 포함 노트)
- 수동 빌드: `gh workflow run release-pi-finance-container.yml -f tag=1.2.3`
- 확인: `docker manifest inspect ghcr.io/preinpost/pi-finance:latest` (amd64/arm64)

## 트러블슈팅

| 증상 | 원인/대응 |
|---|---|
| Publish 단계 실패 | GitHub Secrets `NPM_TOKEN` 권한 확인 (publish scope) |
| 버전이 안 올라감 | 커밋 메시지가 `feat/fix` 등 규칙에 안 맞거나, 푸시 커밋이 `[skip ci]` |
| tarball에 `workspace:*` 잔존 | ci.yml의 tarball 검증이 잡음 — pnpm publish가 재작성하므로 로컬 pack 출력과 혼동 주의 |
| 형제 패키지 워크플로우 오발동 | 커밋에 타 패키지 파일이 섞였는지 확인 (`git status`로 범위 확인) |
| 컨테이너가 자꾸 돎 | 의도된 동작(latest 갱신). docs 커밋엔 `[skip ci]` |

## 패키지 내 스킬 배포

- pi-* 패키지의 `skills/<name>/SKILL.md`는 npm tarball(`files`)에 포함되면 설치 후 자동 발견됨 — 별도 등록 불필요
- 스킬 추가 시 `pnpm pack --dry-run`으로 tarball 포함 여부 검증 후 릴리스
