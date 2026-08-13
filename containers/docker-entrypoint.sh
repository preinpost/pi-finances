#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# pi-finances 컨테이너 엔트리포인트
#
# 동작 모드:
#   기본          — 웹챗 (pi-web-chat, 포트 8080, 비밀번호 게이트)
#   PI_HEADLESS=1 — pi -p --mode json 헤드리스 배치 실행 (인자/표준입력으로 프롬프트)
#
# 설계 근거: CONTAINER-DESIGN.md
#   §5 — 시크릿 스토어 파일을 제거해 env 주입 키가 항상 우선하도록 보장
#   §8 — 키는 에페메럴(컨테이너 수명)로만 유지
#   WEB-APP-DESIGN.md — 웹챗이 기본 인터페이스 (ttyd 제거)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

# 0) 기본 모델/thinking — compose.yaml에서 키와 한 세트로 주입 가능
#    PI_DEFAULT_MODEL="deepseek/deepseek-v4-pro" (provider/id, pi --list-models로 확인)
#    PI_DEFAULT_THINKING="high" (off|minimal|low|medium|high|xhigh|max)
#    → 헤드리스는 --model / --thinking 플래그로 전달, 웹챗은 서버가 env를 직접 읽음
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

# 2) 헤드리스 배치 모드 (동일 이미지로 cron/CI 리포트 생성)
if [ "${PI_HEADLESS:-0}" = "1" ]; then
  exec pi -p --mode json "${MODEL_ARGS[@]}" "$@"
fi

# 3) 기본 모드: 웹챗 (비밀번호 게이트 — PI_WEB_PASSWORD 미설정 시 서버가 생성·로그 출력)
exec node /opt/pi-web/dist/index.js
