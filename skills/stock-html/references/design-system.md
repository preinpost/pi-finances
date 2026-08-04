# stock-html — Design System 상세 명세

금융 애널리틱스 스킨의 색상 토큰, 타이포그래피, 컴포넌트별 HTML 스켈레톤을 정의한다.
전부 **self-contained**(인라인 CSS, 외부 의존 없음). 한국 주식 관례(상승=빨강, 하락=파랑)를 따른다.

## 1. 디자인 토큰

```css
:root {
  /* 캔버스/카드 */
  --bg: #F5F6F8;            /* 페이지 배경 (cool gray) */
  --card: #FFFFFF;          /* 카드 배경 */
  --border: #E5E7EB;        /* 테두리/구분선 */
  --ink: #171A21;           /* 기본 텍스트 (네이비 잉크) */
  --muted: #6B7280;         /* 보조 텍스트 */
  --accent: #2B5CFF;        /* 액센트 블루 — 링크/타이틀/라인차트 */

  /* 시맨틱 — 한국 관례: 상승=빨강, 하락=파랑 */
  --up: #E23A3A;            /* 상승/매수/미스 */
  --down: #3B6FE0;          /* 하락/매도 */
  --neutral: #6B7280;       /* 관망/중립 */
  --warn: #D97706;          /* 경고/리스크 */
  --pass: #0F9D58;          /* 상회/긍정 배지 */
  --radius: 12px;
  --shadow: 0 1px 3px rgba(23, 26, 33, 0.06);
}
```

범례(문서 헤더 아래, 항상 포함):

```html
<div class="legend">
  <span class="dot" style="background:#E23A3A"></span>상승/매수
  <span class="dot" style="background:#3B6FE0"></span>하락/매도
  <span class="dot" style="background:#6B7280"></span>관망/중립
  <span class="dot" style="background:#0F9D58"></span>상회
  <span class="dot" style="background:#D97706"></span>리스크
</div>
```

## 2. 타이포그래피

```css
body {
  font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
    "Noto Sans KR", "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;   /* 숫자 폭 균일 */
  color: var(--ink); background: var(--bg);
  line-height: 1.55;
}
pre, code { font-family: ui-monospace, SF Mono, Menlo, Consolas, monospace; }
```

- 헤딩: Pretendard Bold, `1.15~1.35em`. 섹션 타이틀은 번호 이모지(1️⃣ 등) + 텍스트.
- 숫자/통화: tabular-nums 필수. 음수는 `-` 부호 유지, 등락률은 부호 명시(+x.x% / -x.x%).

## 3. 컴포넌트 스켈레톤

### 3.1 헤더

```html
<header class="doc-header">
  <div>
    <h1>🚗 테슬라 (TSLA)</h1>
    <p class="meta">기준: 2026-08-04 장중 · KIS 실시간 + 일봉 300개 · <span class="badge">KIS</span></p>
  </div>
  <div class="legend">…범례…</div>
  <hr class="divider">
</header>
```

```css
.doc-header h1 { font-size: 1.5rem; margin: 0 0 4px; }
.meta { color: var(--muted); font-size: 0.85rem; }
.divider { border: none; border-top: 2px solid var(--ink); margin: 12px 0 20px; }
```

### 3.2 KPI 카드 그리드

```html
<section class="kpi-grid">
  <div class="kpi-card">
    <div class="kpi-label">현재가</div>
    <div class="kpi-value up">$321.79</div>
    <div class="kpi-sub down">-0.09%</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">52주 최고</div>
    <div class="kpi-value">$498.83</div>
    <div class="kpi-sub muted">25.12.22</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">고점대비</div>
    <div class="kpi-value down">-35.5%</div>
    <div class="kpi-sub muted">52주 최저 $297.38 (+8.2%)</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">시가총액</div>
    <div class="kpi-value">약 1조 달러</div>
  </div>
</section>
```

```css
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.kpi-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 14px 16px; }
.kpi-label { font-size: 0.78rem; color: var(--muted); }
.kpi-value { font-size: 1.3rem; font-weight: 700; margin: 2px 0; }
.kpi-sub { font-size: 0.8rem; }
.up { color: var(--up); } .down { color: var(--down); } .muted { color: var(--muted); }
@media (max-width: 720px) { .kpi-grid { grid-template-columns: 1fr 1fr; } }
```

### 3.3 섹션 카드

```html
<section class="section-card">
  <h2 class="section-title">2️⃣ 핵심 구조: 파라볼릭 사이클</h2>
  <div class="section-body">
    <pre class="ascii-block">
$499 ┤   ★ 12/22 파라볼릭 탑 (+52%)
     │  ↗
$297 ┤          ● 7/29 저점 = 연간 이중 바닥</pre>
  </div>
</section>
```

```css
.section-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 16px 20px; margin-bottom: 16px; }
.section-title { font-size: 1.05rem; margin: 0 0 10px; }
.ascii-block { background: #FAFBFC; border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; overflow-x: auto; font-size: 0.78rem; line-height: 1.35; }
```

### 3.4 데이터 표

```html
<table class="data-table">
  <caption class="table-caption">기술적 상태 (일봉·주봉)</caption>
  <thead><tr><th>지표</th><th class="num">일봉</th><th class="num">주봉</th><th>해석</th></tr></thead>
  <tbody>
    <tr><td>MA5 / MA20 / MA60</td><td class="num">$312 / $355 / $394</td>
        <td class="num">$347 / $383 / $392</td><td class="down">역배열 + 데드크로스</td></tr>
    <tr><td>손절 기준</td><td class="num down">$297 이탈</td><td class="num">—</td><td class="warn">구조적 지지 붕괴</td></tr>
  </tbody>
</table>
```

```css
.data-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 6px; }
.data-table th { background: #EEF0F3; text-align: left; padding: 8px 10px; font-weight: 600; }
.data-table td { border-bottom: 1px solid var(--border); padding: 8px 10px; }
.data-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.table-caption { text-align: left; color: var(--muted); font-size: 0.8rem; margin-bottom: 4px; }
.warn { color: var(--warn); }
```

### 3.5 판정 배지

```html
<span class="badge badge-buy">매수</span>
<span class="badge badge-sell">매도</span>
<span class="badge badge-watch">관망</span>
<span class="badge badge-pass">상회</span>
<span class="badge badge-miss">미스</span>
```

```css
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px;
  font-size: 0.78rem; font-weight: 600; color: var(--ink); background: #E5E7EB; }
.badge-buy { background: var(--up); }      /* 매수 = 빨강 (한국 관례) */
.badge-sell { background: var(--down); }   /* 매도 = 파랑 */
.badge-watch { background: var(--neutral); }
.badge-pass { background: var(--pass); }
.badge-miss { background: var(--up); }
```

### 3.6 라인차트 (스파크라인, 인라인 SVG)

종가 배열이 있으면 인라인 SVG 폴리라인으로 렌더링한다 (최대 120포인트, 오래된 순 → 최신 순).
> ⚠️ SVG `id`(linearGradient 등)는 스파크라인마다 고유해야 한다 — `area-1`, `area-2`처럼 인덱스를 붙일 것 (리포트에 스파크라인 2개 이상이면 중복 id 금지).

```html
<figure class="spark">
  <svg viewBox="0 0 600 160" role="img" aria-label="최근 60일 종가 추이">
    <defs>
      <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2B5CFF" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#2B5CFF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="M0,120 L12,110 L24,115 …" fill="none" stroke="#2B5CFF" stroke-width="2"/>
    <path d="M0,120 L12,110 L24,115 … L600,140 L600,160 L0,160 Z" fill="url(#area)"/>
    <circle cx="600" cy="140" r="3.5" fill="#2B5CFF"/>
  </svg>
  <figcaption>최근 60일 종가 (달러)</figcaption>
</figure>
```

```css
.spark svg { width: 100%; height: auto; display: block; }
.spark figcaption { color: var(--muted); font-size: 0.78rem; margin-top: 4px; }
```

생성 규칙: min/max 기준으로 `y` 정규화(하단 여백 8%), `x` 균등 분배, 소수 1자리.

### 3.7 시나리오 확률 바

```html
<table class="data-table">
  <thead><tr><th>시나리오</th><th class="num">확률</th><th>경로</th></tr></thead>
  <tbody>
    <tr>
      <td>베이스: $297 방어</td>
      <td class="num"><div class="pbar"><span class="pfill base" style="width:58%">58%</span></div></td>
      <td>$297~355 박스권 → 뉴스 반등 (0 ~ -8%)</td>
    </tr>
    <tr><td>약세: $297 이탈</td>
      <td class="num"><div class="pbar"><span class="pfill bear" style="width:28%">28%</span></div></td>
      <td>$275 → $271 지지대 (-8 ~ -16%)</td></tr>
    <tr><td>강한 약세</td>
      <td class="num"><div class="pbar"><span class="pfill crash" style="width:14%">14%</span></div></td>
      <td>$240~250 (-22~25%)</td></tr>
  </tbody>
</table>
```

```css
.pbar { display: inline-block; width: 120px; height: 14px; background: #EEF0F3;
  border-radius: 999px; overflow: hidden; vertical-align: middle; }
.pfill { display: block; height: 100%; border-radius: 999px; color: #fff;
  font-size: 0.68rem; line-height: 14px; text-align: center; }
.pfill.base { background: var(--down); } .pfill.bear { background: var(--warn); }
.pfill.crash { background: var(--up); }
```

### 3.8 결론 콜아웃

```html
<section class="conclusion">
  <div class="conclusion-head">
    <span class="badge badge-watch">⛔ 결론: 관망</span>
  </div>
  <div class="conclusion-body">
    <p><strong>매수 트리거 (둘 중 하나):</strong></p>
    <ul class="checklist">
      <li><input type="checkbox" disabled> $355(MA20) 안착 + 골든크로스 → 추세 전환 확인</li>
      <li><input type="checkbox" disabled> $275~297 과매도 진입 + RSI&lt;30 반등 → 분할 1차 진입</li>
    </ul>
    <p class="targets">목표: <span class="up">$355 → $402~413</span> · 손절: <span class="down">$297 이탈</span></p>
  </div>
</section>
```

```css
.conclusion { background: #EFF4FF; border: 1px solid #C9D8FF; border-left: 6px solid var(--accent);
  border-radius: var(--radius); padding: 16px 20px; margin-bottom: 16px; }
.conclusion-head { margin-bottom: 8px; }
.checklist { list-style: none; padding: 0; margin: 6px 0; }
.checklist li { margin: 4px 0; }
.targets { font-weight: 600; }
```

### 3.9 리스크 리스트

```html
<ul class="risk-list">
  <li>밸류 고평가(150x+) — 로보택시 가치가 미래에 전부 걸림</li>
  <li>FCF 마이너스·마진 하락 — 실적발표마다 폭락 패턴 재현 가능</li>
  <li>$297 이탈 시 구조적 하락 가속 → $275 → $271</li>
</ul>
```

```css
.risk-list { list-style: none; padding: 0; margin: 0; }
.risk-list li { background: var(--card); border-left: 4px solid var(--warn);
  border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;
  box-shadow: var(--shadow); }
.risk-list li::before { content: "⚠️ "; }
```

### 3.10 한 줄 요약 + 푸터

```html
<section class="summary">📌 한 줄 요약 — 자동차 성장은 회복했지만 마진·FCF 악화…
  <br>시세·공시 기반 참고 분석이며, 투자 결정의 책임은 본인에게 있습니다.
  실전 주문은 사용자 확인 후에만 진행합니다.</section>

<footer class="doc-footer">생성: 2026-08-04 · pi-kis stock-html</footer>
```

```css
.summary { background: #EFF4FF; border-radius: var(--radius); padding: 14px 18px;
  margin: 8px 0 16px; font-size: 0.9rem; }
.doc-footer { color: var(--muted); font-size: 0.78rem; text-align: center; margin-top: 20px; }
```

## 4. 페이지 스켈레톤 (전체 조립 예)

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>테슬라 (TSLA) 통합 분석 리포트</title>
<style>
  /* 위 토큰 + 컴포넌트 CSS 전체 */
  body { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
  @media print {
    body { background: #fff; padding: 0; }
    .kpi-card, .section-card, .risk-list li { box-shadow: none; }
  }
</style>
</head>
<body>
  <!-- 헤더 → KPI → 섹션 카드들 → 결론 → 시나리오 → 리스크 → 요약 → 푸터 -->
</body>
</html>
```

## 5. 인쇄/모바일 규칙

- `@media print`: 카드 그림자·배경색 제거(흰 배경), 색상 대비 유지 위해 배지/텍스트 색은 유지.
- 모바일: KPI 2열, 표는 `overflow-x: auto` 래퍼(필요 시), 섹션 패딩 축소.
- 색맹 고려: 색만으로 의미 전달하지 말고 배지 텍스트(매수/매도/상회)를 병기한다.
