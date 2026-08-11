#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# pi-finances 컨테이너 엔트리포인트
#
# 동작 모드:
#   기본         — ttyd 웹터미널로 pi TUI 서빙 (포트 7681, basic-auth 토큰)
#   PI_WEB=1     — 웹챗 백엔드 (Phase 3 — WEB-APP-DESIGN.md §7, 포트 8080)
#   PI_HEADLESS=1 — pi -p --mode json 헤드리스 배치 실행 (인자/표준입력으로 프롬프트)
#   (PI_WEB이 PI_HEADLESS보다 우선)
#
# 설계 근거: CONTAINER-DESIGN.md
#   §5 — 시크릿 스토어 파일을 제거해 env 주입 키가 항상 우선하도록 보장
#   §6 — ttyd 웹터미널, 헤드리스 겸용
#   §8 — 키는 에페메럴(컨테이너 수명)로만 유지
#   WEB-APP-DESIGN.md §7 — 웹챗 배포 (PI_WEB=1 → node /opt/pi-web/dist/index.js)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

# 0) 기본 모델/thinking — compose.yaml에서 키와 한 세트로 주입 가능
#    PI_DEFAULT_MODEL="deepseek/deepseek-v4-pro" (provider/id, pi --list-models로 확인)
#    PI_DEFAULT_THINKING="high" (off|minimal|low|medium|high|xhigh|max)
#    → pi CLI의 --model / --thinking 플래그로 전달 (TUI 안에서 /model 로 변경 가능)
MODEL_ARGS=()
if [ -n "${PI_DEFAULT_MODEL:-}" ]; then
  MODEL_ARGS+=(--model "$PI_DEFAULT_MODEL")
fi
if [ -n "${PI_DEFAULT_THINKING:-}" ]; then
  MODEL_ARGS+=(--thinking "$PI_DEFAULT_THINKING")
fi

# 1) 시크릿 스토어 파일 제거
#    env로 주입한 키가 항상 우선하도록 한다. 스토어 파일 값이 env보다 우선하는
#    (file ?? env) 구조이므로, 볼륨 등에 남은 과거 키가 새 env를 가리는 사고를 방지.
#    에페메럴 파드 모델(키 = 컨테이너 수명)이므로 삭제해도 무방하다.
rm -f "$AGENT_DIR"/*-keys.json

# 2) 웹챗 모드 (Phase 3 — pi-web-chat) — PI_HEADLESS보다 우선
#    pi-web-chat 서버(dist/index.js)가 PI_DEFAULT_MODEL/THINKING·PORT·HOST·PI_WEB_CWD를 env로 읽는다
if [ "${PI_WEB:-0}" = "1" ]; then
  exec node /opt/pi-web/dist/index.js
fi

# 3) 헤드리스 배치 모드 (동일 이미지로 cron/CI 리포트 생성)
#    토큰 생성 이전에 분기 — 배치 로그에 토큰 노이즈 없음
if [ "${PI_HEADLESS:-0}" = "1" ]; then
  exec pi -p --mode json "${MODEL_ARGS[@]}" "$@"
fi

# 4) 웹터미널 토큰 — 미설정 시 자동 생성해 로그에 출력 (로컬/개발용)
#    운영 환경에서는 백엔드가 TTYD_TOKEN을 주입한다 (설계 §8.3).
if [ -z "${TTYD_TOKEN:-}" ]; then
  TTYD_TOKEN="$(openssl rand -hex 16)"
  echo "[pi-finance] TTYD_TOKEN 미설정 → 자동 생성" >&2
  echo "[pi-finance] 웹터미널: http://localhost:7681  user=pi  token=${TTYD_TOKEN}" >&2
fi

# 5) 기본 모드: 웹터미널(ttyd) → pi TUI
#    -W: 쓰기 가능한 터미널 / -c: basic-auth(user:token)
exec ttyd -W -p 7681 -c "pi:${TTYD_TOKEN}" -- pi "${MODEL_ARGS[@]}"
