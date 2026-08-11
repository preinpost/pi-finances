# pi-web-chat — 업스트림 동기화 메모

- 업스트림: https://github.com/preinpost/pi-web-chat (MIT)
- 벤더링 기준: 커밋 `76235d4` (fix(ui): disable GFM strikethrough in chat markdown), 버전 v0.1.19 (npm: pi-web-chat)
- 동기화: `rsync -a --exclude node_modules --exclude .git --exclude .github --exclude dist --exclude extensions <pi-web>/ ./` (HANDOFF/README 제외)
- 로컬 적응(업스트림 미포함): **없음** (금융 템플릿 버튼·`/api/templates`는 2026-08-11 제거 — 업스트림 그대로 사용)
- 컨테이너 전용 설정은 코드 기본값이 아니라 env(PORT/HOST/PI_WEB_CWD)로 주입 (Dockerfile 참조)
