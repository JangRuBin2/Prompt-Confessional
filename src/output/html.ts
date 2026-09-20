import * as fs from 'fs';
import * as path from 'path';
import { MonthlyReport } from '../types';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

/**
 * 월간 리포트를 자급자족 HTML 파일로 생성
 * - 외부 CDN 없이 인라인 CSS/JS만 사용
 * - 순수 CSS 바 차트
 */
export function generateHTMLReport(report: MonthlyReport): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, `report_${report.month}.html`);
  const html = buildHTML(report);

  fs.writeFileSync(outputPath, html, 'utf-8');
  console.log(`[HTML] 리포트 생성 완료: ${outputPath}`);
  return outputPath;
}

function formatHtmlDelta(delta: number | null, unit = '', decimals = 0): string {
  if (delta === null) return `<div class="behavior-delta neutral">(전월 없음)</div>`;
  const sign = delta >= 0 ? '+' : '';
  const val = decimals > 0 ? delta.toFixed(decimals) : String(Math.round(delta));
  const arrow = delta > 0 ? ' ↑' : delta < 0 ? ' ↓' : '';
  const cssClass = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  return `<div class="behavior-delta ${cssClass}">${sign}${val}${unit}${arrow}</div>`;
}

function buildHTML(report: MonthlyReport): string {
  const bs = report.behavior_stats;
  const bd = report.behavior_delta;

  // 꼬리질문 비율 바 색상 결정
  const followUpBarClass =
    bs.follow_up_rate >= 60 ? 'good' :
    bs.follow_up_rate >= 30 ? 'medium' : 'low';

  // 주제별 탐구 깊이 테이블 행 생성
  const depthRows = bs.topic_depth
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.topic)}</td><td>${t.avg_messages}회</td></tr>`
    )
    .join('\n          ');

  const maxCount = Math.max(...report.top_topics.map((t) => t.count), 1);

  const topicBars = report.top_topics
    .map((topic, index) => {
      const barPercent = Math.round((topic.count / maxCount) * 100);
      const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : '';
      return `
      <div class="topic-row ${rankClass}">
        <div class="topic-rank">#${index + 1}</div>
        <div class="topic-name">${escapeHtml(topic.topic)}</div>
        <div class="topic-bar-wrap">
          <div class="topic-bar" style="width: ${barPercent}%"></div>
        </div>
        <div class="topic-meta">
          <span class="topic-count">${topic.count}건</span>
          <span class="topic-percent">${topic.percentage}%</span>
        </div>
      </div>`;
    })
    .join('\n');

  const wellDoneItems = report.well_done
    .map((item) => `<li class="list-item success-item">${escapeHtml(item)}</li>`)
    .join('\n');

  const improvementItems = report.improvements
    .map((item) => `<li class="list-item improvement-item">${escapeHtml(item)}</li>`)
    .join('\n');

  const generatedDate = new Date(report.generated_at).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const [year, monthNum] = report.month.split('-');
  const monthLabel = `${year}년 ${parseInt(monthNum, 10)}월`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MyLLM Report — ${monthLabel}</title>
  <style>
    /* ===== CSS 리셋 & 기본 스타일 ===== */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --surface-2: #22263a;
      --border: #2e3248;
      --text: #e8eaf6;
      --text-muted: #8892b0;
      --primary: #7c6af7;
      --primary-light: #a29bfe;
      --success: #43d17a;
      --warning: #fdc96f;
      --danger: #ff6b6b;
      --rank-1: #ffd700;
      --rank-2: #c0c0c0;
      --rank-3: #cd7f32;
      --radius: 12px;
      --shadow: 0 4px 24px rgba(0,0,0,0.4);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ===== 레이아웃 ===== */
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }

    /* ===== 헤더 ===== */
    .header {
      text-align: center;
      padding: 3rem 2rem 2rem;
      background: linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      margin-bottom: 2rem;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }

    .header::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle at 50% 50%, rgba(124, 106, 247, 0.08) 0%, transparent 60%);
      pointer-events: none;
    }

    .header-badge {
      display: inline-block;
      background: rgba(124, 106, 247, 0.15);
      border: 1px solid rgba(124, 106, 247, 0.4);
      color: var(--primary-light);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.3rem 0.8rem;
      border-radius: 999px;
      margin-bottom: 1rem;
    }

    .header h1 {
      font-size: 2.4rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, var(--text) 0%, var(--primary-light) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header-subtitle {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 0.5rem;
    }

    /* ===== 통계 카드 ===== */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      text-align: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow);
    }

    .stat-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--primary-light);
      line-height: 1.2;
    }

    .stat-label {
      font-size: 0.82rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    /* ===== 섹션 카드 ===== */
    .section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem;
      margin-bottom: 1.5rem;
      box-shadow: var(--shadow);
    }

    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    /* ===== 주제 바 차트 ===== */
    .topic-row {
      display: grid;
      grid-template-columns: 2rem 160px 1fr 100px;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
    }

    .topic-row:last-child { border-bottom: none; }

    .topic-rank {
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--text-muted);
      text-align: center;
    }

    .topic-row.rank-1 .topic-rank { color: var(--rank-1); font-size: 1rem; }
    .topic-row.rank-2 .topic-rank { color: var(--rank-2); font-size: 0.95rem; }
    .topic-row.rank-3 .topic-rank { color: var(--rank-3); }

    .topic-name {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .topic-bar-wrap {
      background: var(--surface-2);
      border-radius: 999px;
      height: 10px;
      overflow: hidden;
    }

    .topic-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%);
      border-radius: 999px;
      transition: width 0.6s ease;
    }

    .topic-row.rank-1 .topic-bar {
      background: linear-gradient(90deg, #f0a500 0%, var(--rank-1) 100%);
    }

    .topic-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.1rem;
    }

    .topic-count {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--primary-light);
    }

    .topic-percent {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    /* ===== 리스트 ===== */
    .feedback-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .list-item {
      padding: 0.85rem 1rem 0.85rem 2.75rem;
      border-radius: 8px;
      font-size: 0.9rem;
      line-height: 1.5;
      position: relative;
    }

    .list-item::before {
      position: absolute;
      left: 0.85rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 1.1rem;
    }

    .success-item {
      background: rgba(67, 209, 122, 0.08);
      border: 1px solid rgba(67, 209, 122, 0.2);
      color: var(--text);
    }

    .success-item::before { content: '✅'; }

    .improvement-item {
      background: rgba(253, 201, 111, 0.08);
      border: 1px solid rgba(253, 201, 111, 0.2);
      color: var(--text);
    }

    .improvement-item::before { content: '💡'; }

    /* ===== 푸터 ===== */
    .footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.78rem;
      padding-top: 1.5rem;
    }

    .footer a {
      color: var(--primary-light);
      text-decoration: none;
    }

    /* ===== 행동 분석 섹션 ===== */
    .behavior-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .behavior-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
    }

    .behavior-label {
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-bottom: 0.3rem;
    }

    .behavior-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--primary-light);
      line-height: 1.2;
    }

    .behavior-unit {
      font-size: 0.8rem;
      font-weight: 400;
      color: var(--text-muted);
      margin-left: 0.2rem;
    }

    .behavior-delta {
      font-size: 0.78rem;
      font-weight: 600;
      margin-top: 0.35rem;
    }

    .behavior-delta.positive { color: var(--success); }
    .behavior-delta.negative { color: var(--danger); }
    .behavior-delta.neutral  { color: var(--text-muted); }

    /* 꼬리질문 비율 바 */
    .followup-bar-wrap {
      background: var(--surface-2);
      border-radius: 999px;
      height: 8px;
      overflow: hidden;
      margin-top: 0.4rem;
    }

    .followup-bar {
      height: 100%;
      border-radius: 999px;
      transition: width 0.6s ease;
    }

    .followup-bar.good   { background: var(--success); }
    .followup-bar.medium { background: var(--warning); }
    .followup-bar.low    { background: var(--danger); }

    /* 주제 탐구 깊이 테이블 */
    .depth-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
    }

    .depth-table th {
      text-align: left;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.78rem;
      padding: 0.3rem 0.5rem 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .depth-table td {
      padding: 0.45rem 0.5rem;
      border-bottom: 1px solid var(--border);
      color: var(--text);
    }

    .depth-table tr:last-child td { border-bottom: none; }

    .depth-table td:last-child {
      text-align: right;
      color: var(--primary-light);
      font-weight: 600;
    }

    /* ===== 반응형 ===== */
    @media (max-width: 600px) {
      .header h1 { font-size: 1.8rem; }
      .topic-row { grid-template-columns: 1.5rem 120px 1fr 70px; gap: 0.5rem; }
      .topic-name { font-size: 0.8rem; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
      .behavior-grid { grid-template-columns: 1fr 1fr; }
    }

    @media (max-width: 400px) {
      .topic-row { grid-template-columns: 1.5rem 90px 1fr 60px; }
      .behavior-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- 헤더 -->
    <header class="header">
      <div class="header-badge">MyLLM Report</div>
      <h1>${monthLabel} 리포트</h1>
      <p class="header-subtitle">AI 대화 사용 패턴 월간 분석 &bull; 로컬 LLM(Ollama) 생성</p>
    </header>

    <!-- 통계 카드 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">💬</div>
        <div class="stat-value">${report.total_conversations.toLocaleString()}</div>
        <div class="stat-label">총 대화 수</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🔤</div>
        <div class="stat-value">${(report.total_tokens / 1000).toFixed(1)}K</div>
        <div class="stat-label">총 예상 토큰</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏷️</div>
        <div class="stat-value">${report.top_topics.length}</div>
        <div class="stat-label">주요 주제 수</div>
      </div>
    </div>

    <!-- 행동 분석 -->
    <section class="section">
      <h2 class="section-title">🔍 행동 분석</h2>
      ${report.prev_month ? `<p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:1rem;">비교 기준: ${report.prev_month}</p>` : ''}
      <div class="behavior-grid">
        <div class="behavior-card">
          <div class="behavior-label">대화당 평균 교환</div>
          <div class="behavior-value">${bs.avg_messages_per_conv}<span class="behavior-unit">회</span></div>
          ${formatHtmlDelta(bd?.avg_messages_per_conv ?? null, '회', 1)}
        </div>
        <div class="behavior-card">
          <div class="behavior-label">꼬리질문 비율</div>
          <div class="behavior-value">${bs.follow_up_rate}<span class="behavior-unit">%</span></div>
          <div class="followup-bar-wrap">
            <div class="followup-bar ${followUpBarClass}" style="width: ${Math.min(bs.follow_up_rate, 100)}%"></div>
          </div>
          ${formatHtmlDelta(bd?.follow_up_rate ?? null, '%p')}
        </div>
        <div class="behavior-card">
          <div class="behavior-label">평균 질문 길이</div>
          <div class="behavior-value">${bs.avg_user_chars_per_conv.toLocaleString()}<span class="behavior-unit">자</span></div>
          ${formatHtmlDelta(bd?.avg_user_chars_per_conv ?? null, '자')}
        </div>
        <div class="behavior-card">
          <div class="behavior-label">탐색 주제 다양성</div>
          <div class="behavior-value">${bs.exploration_breadth}<span class="behavior-unit">개</span></div>
          ${formatHtmlDelta(bd?.exploration_breadth ?? null, '개')}
        </div>
      </div>
      ${
        depthRows
          ? `<table class="depth-table">
        <thead><tr><th>주제</th><th>평균 교환 수</th></tr></thead>
        <tbody>
          ${depthRows}
        </tbody>
      </table>`
          : ''
      }
    </section>

    <!-- Top 5 주제 -->
    <section class="section">
      <h2 class="section-title">📊 Top ${report.top_topics.length} 주제</h2>
      <div class="topic-chart">
        ${topicBars}
      </div>
    </section>

    <!-- 잘한 점 -->
    <section class="section">
      <h2 class="section-title">잘한 점</h2>
      <ul class="feedback-list">
        ${wellDoneItems}
      </ul>
    </section>

    <!-- 개선할 점 -->
    <section class="section">
      <h2 class="section-title">개선할 점</h2>
      <ul class="feedback-list">
        ${improvementItems}
      </ul>
    </section>

    <!-- 푸터 -->
    <footer class="footer">
      <p>생성일: ${generatedDate} &bull; <strong>MyLLM Report</strong> — 로컬 LLM 기반 AI 대화 분석 도구</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * HTML 특수 문자 이스케이프
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
