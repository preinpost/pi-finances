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
   (컨테이너 관련 코드 없음 — 릴리스 성공이 workflow_run 후속 이벤트로 컨테이너를 트리거)
3. 컨테이너 워크플로우 `.github/workflows/release-pi-finance-container.yml`:
   - **버전 단일 소스 = `containers/VERSION`** — **후속 트리거(`workflow_run`)**: npm 패키지 릴리스가
     성공으로 완료되면 이 워크플로우가 `containers/VERSION` patch+1 커밋(`[skip ci]`) →
     **버전 이미지(0.1.1 등)+latest 빌드·푸시 + git 태그 v0.1.1 + GitHub Release 자동 생성**
   - `[skip ci]` 커밋은 GHA가 런 자체를 만들지 않으므로 이중 발화 없음. 릴리스 실패는 `conclusion == 'success'` 필터로 제외
   - `containers/**` 변경이 있는 main 푸시 → VERSION patch+1 후 버전 태그+latest
   - 그 외 main 푸시 → `latest`만 갱신
   - 수동 경로 유지: `v*` 태그 푸시 → semver 태그+latest+Release / `workflow_dispatch` → 입력 tag (없으면 `sha-<short>`)
   - 자동 릴리스가 만든 v* 태그는 GITHUB_TOKEN으로 생성되어 GHA 이벤트가 발생하지 않음 (이중 빌드 구조적 방지)
   - 수동 v* 태그 푸시의 재트리거는 릴리스 존재 확인 후 빌드 스킵

## 배포 절차 (전체 흐름)

```
작업 → 로컬 검증 → 커밋(Conventional) → main 푸시
  → npm 패키지 릴리스 자동 (패키지별 워크플로우)
  → workflow_run 후속 트리거 → 컨테이너 버전 patch+1 → 버전 이미지+latest 빌드·푸시 + v* 태그/릴리스 자동
```

> 컴포넌트 릴리스 또는 `containers/**`(웹챗·이미지) 변경마다 Docker 이미지 patch가 오릅니다.
> 전체 확인은 `gh run list --workflow release-pi-finance-container.yml` + `docker manifest inspect ghcr.io/preinpost/pi-finance:<버전>`

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

### 3단계 — Docker 컨테이너 (완전 자동)

- **npm 패키지 릴리스 → 자동**: 릴리스 워크플로우가 성공 완료되면 `workflow_run` 후속 이벤트로
  컨테이너 워크플로우가 `containers/VERSION` patch+1 커밋(`[skip ci]`) →
  버전 태그(0.1.1, 0.1) + latest 빌드·푸시 → git 태그 v0.1.1 + GitHub Release 자동 생성
  (패키지 워크플로우는 손댈 필요 없음 — 별도 조치 불필요)
- **버전 릴리스 수동**: `git tag v1.2.3 && git push origin v1.2.3` → semver 태그 + latest + GitHub Release (digest 포함 노트)
- **수동 빌드**: `gh workflow run release-pi-finance-container.yml -f tag=1.2.3`
- 확인: `docker manifest inspect ghcr.io/preinpost/pi-finance:latest` (amd64/arm64)

## 트러블슈팅

| 증상 | 원인/대응 |
|---|---|
| Publish 단계 실패 | GitHub Secrets `NPM_TOKEN` 권한 확인 (publish scope) |
| 버전이 안 올라감 | 커밋 메시지가 `feat/fix` 등 규칙에 안 맞거나, 푸시 커밋이 `[skip ci]` |
| tarball에 `workspace:*` 잔존 | ci.yml의 tarball 검증이 잡음 — pnpm publish가 재작성하므로 로컬 pack 출력과 혼동 주의 |
| 형제 패키지 워크플로우 오발동 | 커밋에 타 패키지 파일이 섞였는지 확인 (`git status`로 범위 확인) |
| 컨테이너 버전이 안 오름 | 패키지 릴리스 실패(conclusion 필터), 또는 `[skip ci]` 커밋이 유일 변경(런 없음 → 이벤트 없음 — 정상) |
| 컨테이너 버전이 2씩 뜀 | 두 패키지가 병렬 릴리스 — fetch+reset 재계산으로 직렬화되므로 정상 (각 릴리스당 +1) |
| 컨테이너 워크플로우가 두 번 돎 | 자동 태그 재트리거 — 릴리스 존재 확인 후 빌드 스킵하므로 의도된 동작 |

## 패키지 내 스킬 배포

- pi-* 패키지의 `skills/<name>/SKILL.md`는 npm tarball(`files`)에 포함되면 설치 후 자동 발견됨 — 별도 등록 불필요
- 스킬 추가 시 `pnpm pack --dry-run`으로 tarball 포함 여부 검증 후 릴리스
