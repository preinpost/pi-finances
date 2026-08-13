---
description: 종목 딥다이브 — 가격·차트·지표·리서치·뉴스 종합 분석
argument-hint: "<종목명 또는 종목코드>"
---
${1} 종목을 딥다이브 분석해줘.

절차:
0. `market_status`로 사용 가능한 데이터 제공자 확인 (미설정 제공자 툴은 호출 금지)
1. 종목 확인: `kis_domestic_price` 또는 `broker_price`로 현재가·등락·거래대금
2. 차트: `kis-timing` 스킬 — 일봉/주봉, 이동평균·RSI·볼린저·지지/저항
3. 리서치: `kis_research`로 재무·밸류에이션 (finnhub_fundamentals는 finnhub 설정 확인 시)
4. 뉴스: `naver_news_search`로 최근 이슈 (finnhub_news는 finnhub 설정 확인 시)
5. 해외/글로벌 연관 시: market_status에서 설정된 제공자의 툴만 보강

출력 형식: 투자 포인트 요약 → 가격/차트 → 재무/밸류 → 뉴스/이슈 → 리스크 →
타점 관점(kis-timing) → 면책 문구
("본 리포트는 참고용 정보 제공이며, 투자 결정의 최종 책임은 사용자에게 있습니다.")
