# pi 금융분석 에이전트 컨테이너
#
# pi 하네스 + pi-finances 패키지(pi-kis/toss/twelve-data/finnhub/coingecko/binance/naver-news) +
# 금융분석 설정(AGENTS.md, persona, 프롬프트 템플릿)을 bake한 이미지.
# 설계 근거: 루트 CONTAINER-DESIGN.md (§4 이미지 설계)
# pi 공식 컨테이너화 패턴: pi docs/containerization.md (node:24-bookworm-slim 기준)

# ── 웹 프론트/서버 빌드 (pi-web-chat 소스 벤더링 — WEB-APP-DESIGN.md §7) ──
# dist만 산출 — 런타임 이미지에는 devDependencies가 들어가지 않는다
FROM node:24-bookworm-slim AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY agent-config/fluent-korean.md /build/agent-config/fluent-korean.md
COPY VERSION /build/VERSION
RUN npm run build   # vite(프론트 dist/public) + esbuild(서버 dist/index.js) — VERSION → __APP_VERSION__

# ════════════════════════════════════════════════════════════════════
# 런타임 이미지
# ════════════════════════════════════════════════════════════════════
FROM node:24-bookworm-slim

# ── 베이스 ───────────────────────────────────────────────────────────
# bash/ca-certificates/git/ripgrep: pi 공식 Dockerfile 권장 구성
# tzdata: 한국 시장 시간(TZ=Asia/Seoul)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     bash ca-certificates git ripgrep tzdata \
  && rm -rf /var/lib/apt/lists/*

# ── pi 하네스 (글로벌 설치) ─────────────────────────────────────────
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# ── 금융분석 에이전트 환경 ──────────────────────────────────────────
# PI_CODING_AGENT_DIR: 에이전트 디렉터리를 HOME과 무관한 고정 경로로 (설계 §3 결정 5)
# KIS_SECRET_STORE=file: 컨테이너에는 keyring(Secret Service)이 없으므로 파일 백엔드 강제 (설계 §3 결정 3)
ENV TZ=Asia/Seoul \
    PI_CODING_AGENT_DIR=/opt/pi-agent \
    KIS_SECRET_STORE=file

# ── 금융 패키지 설치 (빌드 타임, 유저 스코프 → /opt/pi-agent) ───────
# VERSION을 먼저 COPY — 컨테이너 버전 범프마다 이 레이어 캐시가 깨져
# npm:pi-* 최신(예: pi-binance 0.2.0 평단가·주문이력)이 다시 설치된다.
# (RUN 줄만 같고 VERSION만 오르면 Docker는 옛 pi-binance@0.1.0 레이어를 재사용했음)
COPY VERSION /tmp/pi-finance.VERSION
# pi install은 소스를 한 번에 하나만 받는다 (CLI 제약) — 패키지별로 실행.
# 빌드 시점 HOME은 /root(기본) — npm 캐시 사용 가능. 런타임 HOME은 아래 useradd 후 설정.
# pi-finance-core(공용 스킬 kis-timing 포함)는 pi-kis/pi-toss에 번들로 자동 포함
# pi-web-access: 웹 검색·URL 페치·GitHub 클론·PDF/유튜브 분석 (금융 리서치 보강, 외부 패키지)
RUN echo "pi-finance $(cat /tmp/pi-finance.VERSION)" \
 && pi install npm:pi-kis \
 && pi install npm:pi-toss \
 && pi install npm:pi-twelve-data \
 && pi install npm:pi-finnhub \
 && pi install npm:pi-coingecko \
 && pi install npm:pi-binance \
 && pi install npm:pi-naver-news \
 && pi install npm:pi-web-access

# ── 금융분석 포커스 설정 (AGENTS.md / APPEND_SYSTEM.md / prompts/*) ──
COPY agent-config/ /opt/pi-agent/

# ── non-root 실행 유저 (설계 §8.4) ──────────────────────────────────
# node:24 이미지에 UID 1000(node 유저)이 이미 존재 → 1001 사용 (빌드 검증 중 발견)
RUN useradd -m -u 1001 pi \
  && mkdir -p /workspace \
  && chown -R pi:pi /opt/pi-agent /workspace

# ── 웹챗 (pi-web-chat — WEB-APP-DESIGN.md §7) ─────────────────────
# dist(프론트+서버 번들) + 런타임 의존성 2종(@earendil-works/pi-coding-agent, ws —
# esbuild가 external로 남김)
COPY --from=web-build /build/web/dist /opt/pi-web/dist
COPY --from=web-build /build/web/package.json /build/web/package-lock.json /opt/pi-web/
RUN npm ci --omit=dev --prefix /opt/pi-web
RUN chown -R pi:pi /opt/pi-web

# 런타임 HOME (pi 사용자) — 빌드 타임 npm 설치와 충돌하지 않도록 useradd 뒤에 설정
ENV HOME=/home/pi \
    PORT=8080 \
    HOST=0.0.0.0 \
    PI_WEB_CWD=/workspace

# ── 엔트리포인트 (웹챗/헤드리스 분기) ───────────────────────────────
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080
USER 1001
WORKDIR /workspace
ENTRYPOINT ["docker-entrypoint.sh"]
