// 마지막 색은 원래 #fab005 였는데 매장이 10곳이 되면서 4번째(#f59f00)와 구분이 안 돼 회색으로 교체
const PALETTE = ['#4263eb', '#1f2329', '#7950f2', '#f59f00', '#2f9e44', '#e8590c', '#15aabf', '#e64980', '#5c7cfa', '#868e96'];
const SENTIMENT_LABEL = { positive: '긍정', negative: '부정', neutral: '중립' };

let summary = null;
let sortKey = 'monthlyActivity';
let sortDir = 'desc';
let donutChart = null;
let monthlyChart = null;
let keywordsChart = null;
let trendChart = null;
let rankData = null;
let newsData = null;
let newsMonthlyChart = null;
let newsPressChart = null;
let newsTopicsChart = null;
let newsSelectedYear = null;
let selectedYear = null;
let currentSource = 'naver';

const SOURCE_LABEL = { naver: '네이버 플레이스', google: '구글', kakao: '카카오맵', app: '라운지엑스앱' };
const SOURCE_SUMMARY_FILE = { naver: 'summary.json', google: 'summary-google.json', kakao: 'summary-kakao.json', app: 'summary-app.json' };
const SOURCE_PAGE_TITLE = {
  naver: '네이버 플레이스 리뷰 모니터링',
  google: '구글 리뷰 모니터링',
  kakao: '카카오맵 리뷰 모니터링',
  app: '라운지엑스앱 모니터링',
  rank: '네이버 플레이스 검색 순위',
  news: '라운지엑스 뉴스 모니터링',
};

const $ = (s) => document.querySelector(s);
const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;
const fmtDateTime = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) : '-');
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emptySummary() {
  return {
    lastUpdated: null,
    totalStores: 0,
    totalReviews: 0,
    avgReviewsPerStore: 0,
    monthlyActivity: 0,
    stores: [],
    recentReviewsByStore: {},
    representativeByStore: {},
    monthlySentimentByYear: {},
    availableYears: [],
    keywordFrequency: [],
  };
}

function toggleView(view) {
  $('#summaryView').hidden = view !== 'summary';
  $('#rankView').hidden = view !== 'rank';
  $('#newsView').hidden = view !== 'news';
}

async function load() {
  if (currentSource === 'rank') return loadRank();
  if (currentSource === 'news') return loadNews();
  toggleView('summary');
  const file = SOURCE_SUMMARY_FILE[currentSource];
  const res = await fetch(`data/${file}`, { cache: 'no-store' });
  if (res.status === 404) {
    summary = emptySummary();
    render();
    showEmptyState();
    return;
  }
  if (!res.ok) throw new Error(`${file} 로드 실패 (${res.status})`);
  summary = await res.json();
  hideEmptyState();
  render();
}

function showEmptyState() {
  let banner = document.querySelector('#emptyBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'emptyBanner';
    banner.className = 'empty-banner';
    document.querySelector('main').prepend(banner);
  }
  if (currentSource === 'app') {
    banner.innerHTML = `
      <strong>라운지엑스앱 모니터링은 준비 중입니다.</strong>
      <p>앱 리뷰·이용 데이터 수집 연동이 완료되면 이곳에 표시됩니다.</p>
    `;
  } else if (currentSource === 'google') {
    banner.innerHTML = `
      <strong>구글 리뷰 데이터가 아직 없습니다.</strong>
      <p>다음 단계로 시작하세요:</p>
      <ol>
        <li><code>.env</code> 에 <code>GOOGLE_PLACES_API_KEY</code> 추가</li>
        <li>터미널에서 <code>npm run find:google</code> 실행 (매장 → place_id 자동 매칭, 1회만)</li>
        <li>우상단 <b>데이터 업데이트</b> 버튼 클릭 또는 <code>npm run update:google</code></li>
      </ol>
    `;
  } else {
    banner.innerHTML = `<strong>${SOURCE_LABEL[currentSource]} 데이터가 없습니다.</strong> 데이터 업데이트 버튼을 눌러주세요.`;
  }
}

function hideEmptyState() {
  document.querySelector('#emptyBanner')?.remove();
}

function render() {
  $('#lastUpdated').textContent = fmtDateTime(summary.lastUpdated);
  buildKpis();
  applySourceLayout();
  drawDonut();
  drawTable();
  setupYearSelector();
  drawMonthly();
  drawKeywords();
}

function kpiCard({ icon, label, value, sub, accent, valueClass }) {
  return `
    <div class="kpi-card${accent ? ' accent' : ''}">
      <div class="kpi-icon"><i data-lucide="${icon}"></i></div>
      <span class="kpi-label">${label}</span>
      <span class="kpi-value${valueClass ? ' ' + valueClass : ''}">${value}</span>
      <span class="kpi-sub">${sub}</span>
    </div>`;
}

function buildKpis() {
  let cards;
  if (currentSource === 'app') {
    const byId = (id) => summary.stores.find((s) => s.id === id);
    const rate = (s) => (s && s.rating != null ? `★ ${Number(s.rating).toFixed(2)}` : '-');
    const cnt = (s) => (s && s.ratingCount != null ? `${s.ratingCount.toLocaleString()}개 평가` : '평가 정보 없음');
    const g = byId('app_google');
    const a = byId('app_apple');
    cards = [
      kpiCard({ icon: 'star', label: '구글 플레이 평점', value: rate(g), sub: cnt(g) }),
      kpiCard({ icon: 'star', label: '애플 앱스토어 평점', value: rate(a), sub: cnt(a) }),
      kpiCard({ icon: 'message-square', label: '총 리뷰 수', value: summary.totalReviews.toLocaleString(), sub: '수집된 텍스트 리뷰' }),
      kpiCard({ icon: 'activity', label: '월간 활성도', value: summary.monthlyActivity.toLocaleString(), sub: '최근 30일 리뷰', accent: true }),
    ];
  } else if (currentSource === 'kakao') {
    // 카카오는 별점만 남기고 글은 안 쓰는 이용자가 많아, 본문 리뷰 수보다 평점이 실질 지표다
    const rated = summary.stores.filter((s) => s.ratingCount > 0);
    const totalRatings = rated.reduce((sum, s) => sum + s.ratingCount, 0);
    const avg = totalRatings
      ? rated.reduce((sum, s) => sum + s.rating * s.ratingCount, 0) / totalRatings
      : null;
    cards = [
      kpiCard({ icon: 'star', label: '평균 평점', value: avg != null ? `★ ${avg.toFixed(2)}` : '-', sub: `${totalRatings.toLocaleString()}개 평가 기준` }),
      kpiCard({ icon: 'store', label: '평가 있는 매장', value: `${rated.length} / ${summary.totalStores}`, sub: '곳' }),
      kpiCard({ icon: 'message-square', label: '본문 리뷰 수', value: summary.totalReviews.toLocaleString(), sub: '글이 있는 리뷰만' }),
      kpiCard({ icon: 'activity', label: '월간 활성도', value: summary.monthlyActivity.toLocaleString(), sub: '최근 30일 리뷰', accent: true }),
    ];
  } else {
    cards = [
      kpiCard({ icon: 'store', label: '총 매장 수', value: summary.totalStores.toLocaleString(), sub: '라운지엑스24h' }),
      kpiCard({ icon: 'message-square', label: '총 리뷰 수', value: summary.totalReviews.toLocaleString(), sub: '누적 수집' }),
      kpiCard({ icon: 'bar-chart-3', label: '매장당 평균 리뷰 수', value: summary.avgReviewsPerStore.toFixed(1), sub: '건' }),
      kpiCard({ icon: 'activity', label: '월간 활성도', value: summary.monthlyActivity.toLocaleString(), sub: '최근 30일 리뷰', accent: true }),
    ];
  }
  $('#kpiRow').innerHTML = cards.join('');
  if (window.lucide) window.lucide.createIcons();
}

function applySourceLayout() {
  const isApp = currentSource === 'app';
  $('#donutTitle').textContent = isApp ? '플랫폼별 리뷰 비중' : '매장별 리뷰 비중';
  $('#tableTitle').textContent = isApp ? '플랫폼별 리뷰 상세' : '매장별 상세';
  $('#tableHint').textContent = isApp
    ? '컬럼 클릭 시 정렬 · 플랫폼명 클릭 시 리뷰 상세'
    : '컬럼 클릭 시 정렬 · 매장명 클릭 시 리뷰 상세';
  $('#nameHeader').textContent = isApp ? '플랫폼' : '매장명';
}

// ===== 검색 순위 뷰 =====
async function loadRank() {
  toggleView('rank');
  $('#pageTitle').textContent = SOURCE_PAGE_TITLE.rank;
  const res = await fetch('data/rank.json', { cache: 'no-store' });
  if (!res.ok) {
    $('#rankBody').innerHTML = '<p class="empty-msg">검색 순위 데이터가 아직 없습니다. 데이터 갱신 후 표시됩니다.</p>';
    $('#lastUpdated').textContent = '-';
    return;
  }
  rankData = await res.json();
  $('#lastUpdated').textContent = fmtDateTime(rankData.lastScrapedAt);
  renderRank();
  loadTrend();
}

async function loadTrend() {
  try {
    const res = await fetch('data/trend.json', { cache: 'no-store' });
    if (!res.ok) {
      $('#trendCard').hidden = true;
      return;
    }
    const trend = await res.json();
    if (!trend.groups || !trend.groups.length || !trend.groups[0].data?.length) {
      $('#trendCard').hidden = true;
      return;
    }
    $('#trendCard').hidden = false;
    drawTrend(trend);
  } catch (e) {
    $('#trendCard').hidden = true;
  }
}

function drawTrend(trend) {
  const ctx = $('#trend');
  if (trendChart) trendChart.destroy();
  const g = trend.groups[0];
  const labels = g.data.map((d) => d.period);
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: trend.groups.map((grp, i) => ({
        label: grp.title,
        data: grp.data.map((d) => d.ratio),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: i === 0 ? 'rgba(66, 99, 235, 0.08)' : 'transparent',
        borderWidth: 2.5,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: i === 0,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: trend.groups.length > 1, position: 'top', align: 'end',
          labels: { color: '#495057', boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: 'circle', font: { family: 'Pretendard, sans-serif', size: 12, weight: '500' } } },
        tooltip: {
          backgroundColor: '#1f2329', padding: 10,
          titleFont: { family: 'Pretendard, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Pretendard, sans-serif', size: 12 },
          callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9a9fa8', maxTicksLimit: 8, font: { family: 'Pretendard, sans-serif', size: 11 } }, border: { color: '#ececf1' } },
        y: { beginAtZero: true, max: 100, ticks: { color: '#9a9fa8', font: { family: 'Pretendard, sans-serif', size: 11 } }, grid: { color: '#f0f0f4' }, border: { display: false } },
      },
    },
  });
}

function rankSparkline(history) {
  const pts = (history || []).map((h) => h.rank).filter((r) => r != null);
  if (pts.length < 2) return '<span class="spark-empty">—</span>';
  const W = 88, H = 26, P = 3;
  const max = Math.max(...pts), min = Math.min(...pts);
  const span = max - min || 1;
  // 순위가 낮을수록(좋을수록) 위로 → y 반전
  const xs = (i) => P + (i * (W - 2 * P)) / (pts.length - 1);
  const ys = (r) => P + ((r - min) / span) * (H - 2 * P);
  const d = pts.map((r, i) => `${xs(i).toFixed(1)},${ys(r).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const lx = xs(pts.length - 1), ly = ys(last);
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <polyline points="${d}" fill="none" stroke="#4263eb" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="#4263eb"/>
  </svg>`;
}

function rankChangeBadge(rec) {
  const cur = rec.rank, prev = rec.prevRank;
  if (cur == null && prev == null) return '<span class="rank-chg flat">-</span>';
  if (prev == null) return '<span class="rank-chg flat">NEW</span>';
  if (cur == null) return '<span class="rank-chg down">▼ 이탈</span>';
  const diff = prev - cur; // +면 순위 상승(개선)
  if (diff === 0) return '<span class="rank-chg flat">–</span>';
  if (diff > 0) return `<span class="rank-chg up">▲ ${diff}</span>`;
  return `<span class="rank-chg down">▼ ${-diff}</span>`;
}

function renderRank() {
  const recs = Object.values(rankData?.records || {});
  if (recs.length === 0) {
    $('#rankBody').innerHTML = '<p class="empty-msg">검색 순위 데이터가 아직 없습니다.</p>';
    return;
  }
  const byStore = new Map();
  for (const r of recs) {
    if (!byStore.has(r.storeId)) byStore.set(r.storeId, { name: r.storeName, rows: [] });
    byStore.get(r.storeId).rows.push(r);
  }
  const rankText = (r) => (r == null ? '<span class="rank-out">100위권 밖</span>' : `<b>${r}</b>위`);
  let html = '';
  for (const { name, rows } of byStore.values()) {
    rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    html += `
      <div class="rank-store">
        <div class="rank-store-name"><span class="store-dot"></span>${escapeHtml(name)}</div>
        <table class="rank-table">
          <thead><tr><th>검색어</th><th>현재 순위</th><th>변동</th><th>추이</th><th>전체</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr>
                  <td class="rank-kw">${escapeHtml(r.keyword)}</td>
                  <td>${rankText(r.rank)}</td>
                  <td>${rankChangeBadge(r)}</td>
                  <td>${rankSparkline(r.history)}</td>
                  <td class="rank-total">${r.total != null ? r.total.toLocaleString() + '곳' : '-'}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
  }
  $('#rankBody').innerHTML = html;
}

// ===== 뉴스 모니터링 뷰 =====
const NEWS_PRESS_TOP_N = 9; // 나머지는 '기타' 로 묶음 — 조각이 많아지면 도넛이 읽히지 않음
const NEWS_RECENT_LIMIT = 120;
const NEWS_TOPIC_TOP_N = 12;

// 기사 제목·요약에서 잡아낼 주제어. 리뷰용 KEYWORD_GROUPS 는 카페 리뷰 전용이라 뉴스엔 부적합
const NEWS_TOPIC_GROUPS = [
  { label: '로봇·자동화', terms: ['로봇', '자동화', '바리스타', '무인'] },
  { label: '투자·유치', terms: ['투자', '유치', '시리즈', '펀딩', '라운드'] },
  { label: '신규 매장·출점', terms: ['오픈', '출점', '입점', '개점', '매장 확대', '1호점'] },
  { label: 'AI·기술', terms: ['ai', '인공지능', '기술', '특허', '알고리즘', '휴머노이드'] },
  { label: '프랜차이즈·가맹', terms: ['프랜차이즈', '가맹', '창업'] },
  { label: '수상·선정', terms: ['수상', '선정', '어워드', '대상', '우수'] },
  { label: '제휴·협업', terms: ['제휴', '협업', '협약', 'mou', '파트너', '맞손'] },
  { label: '해외·수출', terms: ['해외', '수출', '글로벌', '진출'] },
  { label: '매출·실적', terms: ['매출', '실적', '흑자', '성장률'] },
  { label: '카페·커피', terms: ['카페', '커피', '원두', '음료'] },
  { label: '디저트·베이커리', terms: ['디저트', '베이커리', '케이크', '빵'] },
  { label: '푸드테크·외식', terms: ['푸드테크', '외식', '식음료', 'f&b'] },
];

// 탭 두 개는 서로 겹치지 않는다 — 각각 따로 본다.
//  kr       = 국내 매체의 '라운지엑스' 보도
//  overseas = 해외 매체 보도 (언어권 무관)
let newsScope = 'kr';
let newsAgg = null;

async function loadNews() {
  toggleView('news');
  $('#pageTitle').textContent = SOURCE_PAGE_TITLE.news;
  const res = await fetch('data/news.json', { cache: 'no-store' });
  if (!res.ok) {
    newsData = null;
    $('#lastUpdated').textContent = '-';
    $('#newsKpiRow').innerHTML = '';
    $('#newsScopeTabs').innerHTML = '';
    $('#newsList').innerHTML =
      '<p class="empty-msg">뉴스 데이터가 아직 없습니다. 데이터 갱신 후 표시됩니다.</p>';
    return;
  }
  newsData = await res.json();
  $('#lastUpdated').textContent = fmtDateTime(newsData.lastScrapedAt);
  renderNewsScopeTabs();
  renderNews();
}

function newsArticles() {
  const all = newsData.articles || [];
  // region 이 없던 시절 데이터는 전부 국내 수집분이다
  if (newsScope === 'overseas') return all.filter((a) => a.region === 'overseas');
  return all.filter((a) => (a.region || 'kr') === 'kr');
}

// 집계는 선택된 scope 기준으로 그때그때 계산한다 (기사 수가 수백 건이라 비용이 없다)
function aggregateNews(articles) {
  const dated = articles.filter((a) => a.date);

  const monthlyByYear = {};
  for (const a of dated) {
    const [y, m] = a.date.split('-');
    if (!monthlyByYear[y]) monthlyByYear[y] = Array.from({ length: 12 }, () => 0);
    monthlyByYear[y][Number(m) - 1]++;
  }

  const pressCount = new Map();
  for (const a of articles) pressCount.set(a.press, (pressCount.get(a.press) || 0) + 1);

  const topics = NEWS_TOPIC_GROUPS.map((g) => ({ word: g.label, count: 0 }));
  for (const a of articles) {
    const text = `${a.title} ${a.description || ''}`.toLowerCase();
    NEWS_TOPIC_GROUPS.forEach((g, i) => {
      if (g.terms.some((t) => text.includes(t))) topics[i].count++;
    });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const sorted = [...dated].sort((a, b) => b.date.localeCompare(a.date));

  return {
    totalArticles: articles.length,
    monthlyActivity: dated.filter((a) => a.date >= cutoff).length,
    pressCount: pressCount.size,
    latestArticleDate: sorted[0]?.date || null,
    monthlyByYear,
    availableYears: Object.keys(monthlyByYear).map(Number).sort((a, b) => b - a),
    pressBreakdown: [...pressCount.entries()]
      .map(([press, count]) => ({ press, count }))
      .sort((a, b) => b.count - a.count),
    topicFrequency: topics.filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, NEWS_TOPIC_TOP_N),
    recentArticles: sorted.slice(0, NEWS_RECENT_LIMIT),
  };
}

function renderNewsScopeTabs() {
  const kr = newsData.krArticles ?? 0;
  const overseas = newsData.overseasArticles ?? 0;
  $('#newsScopeTabs').innerHTML = [
    { key: 'kr', label: `국내 ${kr}건` },
    { key: 'overseas', label: `해외 ${overseas}건` },
  ]
    .map(
      (t) =>
        `<button class="scope-tab${newsScope === t.key ? ' active' : ''}" data-scope="${t.key}">${t.label}</button>`
    )
    .join('');
  $('#newsScopeHint').textContent = {
    kr: "'라운지엑스'를 직접 언급한 국내 기사",
    overseas: '해외 매체 보도 — 절대량이 적습니다',
  }[newsScope];
  $('#newsScopeTabs').querySelectorAll('.scope-tab').forEach((btn) => {
    btn.onclick = () => {
      if (newsScope === btn.dataset.scope) return;
      newsScope = btn.dataset.scope;
      newsSelectedYear = null; // scope 마다 기사가 있는 연도가 다르다
      renderNewsScopeTabs();
      renderNews();
    };
  });
}

function renderNews() {
  newsAgg = aggregateNews(newsArticles());
  buildNewsKpis();
  setupNewsYearSelector();
  drawNewsMonthly();
  drawNewsPress();
  drawNewsTopics();
  renderNewsList();
}

function buildNewsKpis() {
  const d = newsAgg;
  const scopeSub = { kr: '국내 매체 보도', overseas: '해외 매체 보도' }[newsScope];
  const cards = [
    kpiCard({ icon: 'newspaper', label: '총 기사 수', value: d.totalArticles.toLocaleString(), sub: scopeSub }),
    kpiCard({ icon: 'building-2', label: '보도 언론사', value: d.pressCount.toLocaleString(), sub: '곳' }),
    kpiCard({ icon: 'calendar', label: '최신 기사', value: d.latestArticleDate || '-', sub: '가장 최근 보도일', valueClass: 'kpi-date' }),
    kpiCard({ icon: 'activity', label: '월간 보도량', value: d.monthlyActivity.toLocaleString(), sub: '최근 30일 기사', accent: true }),
  ];
  $('#newsKpiRow').innerHTML = cards.join('');
  if (window.lucide) window.lucide.createIcons();
}

function setupNewsYearSelector() {
  const select = $('#newsYearSelect');
  const years = (newsAgg.availableYears && newsAgg.availableYears.length)
    ? newsAgg.availableYears
    : [new Date().getFullYear()];
  if (!newsSelectedYear || !years.includes(newsSelectedYear)) newsSelectedYear = years[0];
  select.innerHTML = years
    .map((y) => `<option value="${y}" ${y === newsSelectedYear ? 'selected' : ''}>${y}년</option>`)
    .join('');
  select.onchange = () => {
    newsSelectedYear = Number(select.value);
    drawNewsMonthly();
  };
}

function drawNewsMonthly() {
  const ctx = $('#newsMonthly');
  if (newsMonthlyChart) newsMonthlyChart.destroy();
  const byYear = newsAgg.monthlyByYear || {};
  const months = byYear[newsSelectedYear] || Array.from({ length: 12 }, () => 0);
  newsMonthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
      datasets: [
        {
          label: '기사 수',
          data: months,
          backgroundColor: '#4263eb',
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 40,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2329',
          padding: 10,
          titleFont: { family: 'Pretendard, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Pretendard, sans-serif', size: 12 },
          callbacks: { label: (c) => `${c.parsed.y.toLocaleString()}건` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#9a9fa8', font: { family: 'Pretendard, sans-serif', size: 11 } },
          border: { color: '#ececf1' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#9a9fa8', font: { family: 'Pretendard, sans-serif', size: 11 }, precision: 0 },
          grid: { color: '#f0f0f4' },
          border: { display: false },
        },
      },
    },
  });
}

function drawNewsPress() {
  const ctx = $('#newsPress');
  if (newsPressChart) newsPressChart.destroy();
  const all = newsAgg.pressBreakdown || [];
  const top = all.slice(0, NEWS_PRESS_TOP_N);
  const restCount = all.slice(NEWS_PRESS_TOP_N).reduce((sum, p) => sum + p.count, 0);
  const hasRest = restCount > 0;
  const items = hasRest ? [...top, { press: `기타 ${all.length - NEWS_PRESS_TOP_N}곳`, count: restCount }] : top;
  // '기타'는 팔레트를 이어 쓰면 앞쪽 언론사 색과 겹쳐 보인다 → 회색 고정
  const colors = items.map((_, i) => (hasRest && i === items.length - 1 ? '#c1c5cd' : PALETTE[i % PALETTE.length]));
  $('#newsPressHint').textContent =
    all.length > NEWS_PRESS_TOP_N ? `전체 누적 기준 · 상위 ${NEWS_PRESS_TOP_N}곳` : '전체 누적 기준';
  if (items.length === 0) {
    newsPressChart = null;
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    return;
  }
  const total = items.reduce((sum, p) => sum + p.count, 0);
  newsPressChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: items.map((p) => p.press),
      datasets: [
        {
          data: items.map((p) => p.count),
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#495057',
            boxWidth: 10,
            boxHeight: 10,
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { family: 'Pretendard, sans-serif', size: 12, weight: '500' },
          },
        },
        tooltip: {
          backgroundColor: '#1f2329',
          padding: 10,
          titleFont: { family: 'Pretendard, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Pretendard, sans-serif', size: 12 },
          callbacks: {
            label: (c) => `${c.label}: ${c.parsed.toLocaleString()}건 (${((c.parsed / total) * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
}

function drawNewsTopics() {
  const ctx = $('#newsTopics');
  if (newsTopicsChart) newsTopicsChart.destroy();
  const items = newsAgg.topicFrequency || [];
  if (items.length === 0) {
    newsTopicsChart = null;
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    return;
  }
  newsTopicsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map((t) => t.word),
      datasets: [
        {
          data: items.map((t) => t.count),
          backgroundColor: '#4263eb',
          borderRadius: 6,
          borderSkipped: false,
          barThickness: 'flex',
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2329',
          padding: 10,
          titleFont: { family: 'Pretendard, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Pretendard, sans-serif', size: 12 },
          callbacks: { label: (c) => `${c.parsed.x.toLocaleString()}개 기사에서 언급` },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: '#9a9fa8', font: { family: 'Pretendard, sans-serif', size: 11 }, precision: 0 },
          grid: { color: '#f0f0f4' },
          border: { display: false },
        },
        y: {
          ticks: { color: '#495057', font: { family: 'Pretendard, sans-serif', size: 12, weight: '500' } },
          grid: { display: false },
          border: { color: '#ececf1' },
        },
      },
    },
  });
}

function renderNewsList() {
  const items = newsAgg.recentArticles || [];
  if (items.length === 0) {
    $('#newsList').innerHTML = '<p class="empty-msg">수집된 기사가 없습니다.</p>';
    return;
  }
  // 수집 시점이 아니라 보도일 기준으로 월 구분 — 같은 날 여러 건이 흔해서 날짜만으로는 덩어리가 커짐
  let html = '';
  let lastMonth = null;
  for (const a of items) {
    const month = (a.date || '').slice(0, 7);
    if (month && month !== lastMonth) {
      lastMonth = month;
      const [y, m] = month.split('-');
      html += `<div class="news-month">${y}년 ${Number(m)}월</div>`;
    }
    html += `
      <a class="news-item" href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer">
        <div class="news-item-main">
          <span class="news-title">${escapeHtml(a.title)}</span>
          <span class="news-desc">${escapeHtml(a.description || '')}</span>
        </div>
        <div class="news-item-meta">
          <span class="news-press">${escapeHtml(a.press)}</span>
          <span class="news-date">${escapeHtml(a.date || '-')}</span>
        </div>
      </a>`;
  }
  $('#newsList').innerHTML = html;
}

const KEYWORD_COLOR = { positive: '#2f9e44', negative: '#e03131', neutral: '#4263eb' };

function drawKeywords() {
  const ctx = $('#keywords');
  if (keywordsChart) keywordsChart.destroy();
  const items = summary.keywordFrequency || [];
  if (items.length === 0) {
    keywordsChart = null;
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    return;
  }
  keywordsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map((k) => k.word),
      datasets: [
        {
          data: items.map((k) => k.count),
          backgroundColor: items.map((k) => KEYWORD_COLOR[k.sentiment] || KEYWORD_COLOR.neutral),
          borderRadius: 6,
          borderSkipped: false,
          barThickness: 'flex',
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f2329',
          padding: 10,
          titleFont: { family: 'Pretendard, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Pretendard, sans-serif', size: 12 },
          callbacks: { label: (c) => `${c.parsed.x.toLocaleString()}개 리뷰에서 언급` },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: '#9a9fa8', font: { family: 'Pretendard, sans-serif', size: 11 }, precision: 0 },
          grid: { color: '#f0f0f4' },
          border: { display: false },
        },
        y: {
          ticks: { color: '#495057', font: { family: 'Pretendard, sans-serif', size: 12, weight: '500' } },
          grid: { display: false },
          border: { color: '#ececf1' },
        },
      },
    },
  });
}

function setupYearSelector() {
  const select = $('#yearSelect');
  const years = (summary.availableYears && summary.availableYears.length)
    ? summary.availableYears
    : [new Date().getFullYear()];
  if (!selectedYear || !years.includes(selectedYear)) selectedYear = years[0];
  select.innerHTML = years.map((y) => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}년</option>`).join('');
  select.onchange = () => {
    selectedYear = Number(select.value);
    drawMonthly();
  };
}

function drawMonthly() {
  const ctx = $('#monthly');
  if (monthlyChart) monthlyChart.destroy();
  const byYear = summary.monthlySentimentByYear || {};
  const months = byYear[selectedYear] || Array.from({ length: 12 }, () => ({ positive: 0, negative: 0, neutral: 0 }));
  const labels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
  monthlyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '긍정',
          data: months.map((m) => m.positive),
          borderColor: '#2f9e44',
          backgroundColor: 'rgba(47, 158, 68, 0.08)',
          borderWidth: 2.5,
          tension: 0.35,
          pointRadius: 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#2f9e44',
          pointBorderWidth: 2,
          fill: true,
        },
        {
          label: '부정',
          data: months.map((m) => m.negative),
          borderColor: '#e03131',
          backgroundColor: 'rgba(224, 49, 49, 0.08)',
          borderWidth: 2.5,
          tension: 0.35,
          pointRadius: 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#e03131',
          pointBorderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: '#495057',
            boxWidth: 10,
            boxHeight: 10,
            padding: 14,
            font: { family: 'Pretendard, sans-serif', size: 12, weight: '500' },
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          backgroundColor: '#1f2329',
          padding: 10,
          titleFont: { family: 'Pretendard, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Pretendard, sans-serif', size: 12 },
          callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toLocaleString()}건` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#9a9fa8', font: { family: 'Pretendard, sans-serif', size: 11 } },
          border: { color: '#ececf1' },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#9a9fa8',
            font: { family: 'Pretendard, sans-serif', size: 11 },
            precision: 0,
            stepSize: 1,
          },
          grid: { color: '#f0f0f4' },
          border: { display: false },
        },
      },
    },
  });
}

function drawDonut() {
  const ctx = $('#donut');
  if (donutChart) donutChart.destroy();
  const stores = summary.stores;
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: stores.map((s) => s.name),
      datasets: [
        {
          data: stores.map((s) => s.reviewCount),
          backgroundColor: stores.map((_, i) => PALETTE[i % PALETTE.length]),
          borderColor: '#ffffff',
          borderWidth: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#495057',
            boxWidth: 12,
            boxHeight: 12,
            padding: 14,
            font: { family: 'Pretendard, sans-serif', size: 12, weight: '500' },
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          backgroundColor: '#1f2329',
          padding: 10,
          titleFont: { family: 'Pretendard, sans-serif', size: 12, weight: '600' },
          bodyFont: { family: 'Pretendard, sans-serif', size: 12 },
          callbacks: { label: (c) => `${c.label}: ${c.parsed.toLocaleString()}건` },
        },
      },
    },
  });
}

function drawTable() {
  const tbody = $('#storeTable tbody');
  const rows = [...summary.stores].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
  tbody.innerHTML = rows
    .map(
      (s) => `
    <tr>
      <td><span class="store-link" data-store="${s.id}">${escapeHtml(s.name)}</span>${s.newReviewCount > 0 ? `<span class="new-badge" title="이번 업데이트에서 새로 추가된 리뷰 ${s.newReviewCount}건">NEW${s.newReviewCount > 1 ? ` ${s.newReviewCount}` : ''}</span>` : ''}</td>
      <td>${s.reviewCount.toLocaleString()}</td>
      <td>${barCell(s.positiveRatio, 'positive')}</td>
      <td>${barCell(s.negativeRatio, 'negative')}</td>
      <td>${s.monthlyActivity.toLocaleString()}</td>
      <td>${s.latestReviewDate || '-'}</td>
    </tr>`
    )
    .join('');
  tbody.querySelectorAll('.store-link').forEach((el) => {
    el.addEventListener('click', () => openStore(el.dataset.store));
  });
}

function barCell(v, cls) {
  const w = (v * 100).toFixed(1);
  return `<div class="bar"><div class="bar-track"><div class="bar-fill ${cls}" style="width:${w}%"></div></div><span class="bar-value">${fmtPct(v)}</span></div>`;
}

function renderReviewList(items, emptyMsg) {
  if (!items || items.length === 0) return `<p class="empty-msg">${emptyMsg}</p>`;
  return items
    .map((r) => {
      const reply = r.autoReply || '';
      return `
      <div class="review-item">
        <div class="review-meta">
          ${r.isNew ? '<span class="new-badge">NEW</span>' : ''}
          <span>${escapeHtml(r.date || '')}</span>
          ${r.rating ? `<span>★ ${r.rating}</span>` : ''}
          <span class="sentiment-tag ${r.sentiment || 'neutral'}">${SENTIMENT_LABEL[r.sentiment || 'neutral']}</span>
        </div>
        <div class="review-text">${escapeHtml(r.text)}</div>
        ${
          reply
            ? `<button class="auto-reply-btn" type="button" aria-expanded="false">
          <i data-lucide="sparkles"></i><span class="auto-reply-btn-label">자동 답글</span>
        </button>
        <div class="auto-reply-panel" hidden>
          <div class="auto-reply-head">AI 추천 답글</div>
          <div class="auto-reply-body" data-reply="${escapeHtml(reply)}">${escapeHtml(reply)}</div>
          <button class="auto-reply-copy" type="button">답글 복사</button>
        </div>`
            : ''
        }
      </div>`;
    })
    .join('');
}

function openStore(id) {
  const store = summary.stores.find((s) => s.id === id);
  const recent = (summary.recentReviewsByStore || {})[id] || [];
  const rep = (summary.representativeByStore || {})[id] || { positive: [], negative: [] };
  $('#modalTitle').textContent = `${store?.name ?? id} · 리뷰 상세`;
  $('#modalBody').innerHTML = `
    <section class="review-section">
      <h4 class="review-section-title">최근 리뷰 ${recent.length}건</h4>
      ${renderReviewList(recent, '표시할 리뷰가 없습니다.')}
    </section>
    <section class="review-section">
      <h4 class="review-section-title positive">★ 긍정 대표 ${rep.positive.length}건</h4>
      ${renderReviewList(rep.positive, '기준(글자수 30+, 키워드 2개+)에 맞는 긍정 리뷰가 없습니다.')}
    </section>
    <section class="review-section">
      <h4 class="review-section-title negative">☆ 부정 대표 ${rep.negative.length}건</h4>
      ${renderReviewList(rep.negative, '기준에 맞는 부정 리뷰가 없습니다.')}
    </section>
  `;
  if (window.lucide) window.lucide.createIcons();
  $('#modal').hidden = false;
}

// 자동 답글 버튼: 클릭 시 리뷰 아래로 펼쳐지며 답글 표시 (이벤트 위임)
$('#modalBody').addEventListener('click', (e) => {
  const copyBtn = e.target.closest('.auto-reply-copy');
  if (copyBtn) {
    const text = copyBtn.parentElement.querySelector('.auto-reply-body')?.dataset.reply || '';
    navigator.clipboard?.writeText(text).then(() => showToast('답글을 복사했습니다', 2000));
    return;
  }
  const btn = e.target.closest('.auto-reply-btn');
  if (!btn) return;
  const panel = btn.nextElementSibling;
  const open = btn.getAttribute('aria-expanded') === 'true';
  const label = btn.querySelector('.auto-reply-btn-label');
  if (open) {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('active');
    label.textContent = '자동 답글';
    return;
  }
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('active');
  label.textContent = '답글 닫기';
  // 첫 펼침 시 잠깐 분석 중 표시 후 답글 노출
  if (!panel.dataset.shown) {
    panel.hidden = false;
    panel.classList.add('analyzing');
    setTimeout(() => {
      panel.classList.remove('analyzing');
      panel.dataset.shown = '1';
    }, 550);
  } else {
    panel.hidden = false;
  }
});

document.querySelectorAll('thead th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else {
      sortKey = k;
      sortDir = 'desc';
    }
    drawTable();
  });
});

document.querySelectorAll('[data-close]').forEach((el) => {
  el.addEventListener('click', () => {
    $('#modal').hidden = true;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#modal').hidden = true;
});

function showToast(msg, ms = 2400) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), ms);
}

const HAS_BACKEND = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const PHASE_LABEL = { scrape: '리뷰 수집 중', analyze: '감성 분석 중' };

// GitHub Pages 에는 서버가 없어 수집을 직접 못 돌린다. worker/ 의 Cloudflare Worker 를
// 배포하고 그 URL 을 여기 채우면 버튼이 GitHub Actions 워크플로우를 실제로 트리거한다.
// 비워두면 버튼은 이미 수집된 데이터를 다시 불러오기만 한다.
const TRIGGER_WORKER_URL = '';

// 수집 스케줄 (update.yml cron: '40 11,23 * * *' UTC = 20:40 / 08:40 KST)
const SCHEDULE_TEXT = '매일 오전·저녁 2회';

if (!HAS_BACKEND) {
  document.addEventListener('DOMContentLoaded', () => {
    const label = document.getElementById('refreshLabel');
    const btn = document.getElementById('refreshBtn');
    if (label) label.textContent = TRIGGER_WORKER_URL ? '데이터 업데이트' : '데이터 새로고침';
    if (btn) {
      btn.title = TRIGGER_WORKER_URL
        ? `최신 리뷰를 다시 수집합니다 (GitHub Actions 실행, 3~5분 소요).\n자동 수집은 ${SCHEDULE_TEXT}.`
        : `이미 수집된 데이터를 다시 불러옵니다. 이 버튼은 새 리뷰를 가져오지 않습니다.\n실제 수집은 ${SCHEDULE_TEXT} GitHub Actions 가 자동 실행합니다.`;
    }
  });
}

// Worker 를 통해 워크플로우를 돌리고 끝날 때까지 상태를 폴링한다
async function runRemoteUpdate(label, originalText) {
  label.textContent = '수집 요청 중...';
  const res = await fetch(`${TRIGGER_WORKER_URL}/trigger`, { method: 'POST' });
  if (!res.ok) throw new Error(`트리거 실패 (${res.status})`);
  showToast('수집을 시작했습니다. 3~5분 정도 걸립니다.', 4000);

  const started = Date.now();
  const LIMIT_MS = 10 * 60 * 1000; // 무한 폴링 방지
  while (Date.now() - started < LIMIT_MS) {
    await new Promise((r) => setTimeout(r, 5000));
    const elapsed = Math.floor((Date.now() - started) / 1000);
    label.textContent = `수집 중 ${elapsed}s`;
    let s;
    try {
      s = await (await fetch(`${TRIGGER_WORKER_URL}/status`, { cache: 'no-store' })).json();
    } catch {
      continue; // 일시적 실패는 넘기고 다음 폴링에서 재시도
    }
    if (s.status === 'completed') {
      if (s.conclusion === 'success') {
        await load();
        showToast(`업데이트 완료 · ${elapsed}초 소요`, 3000);
      } else {
        showToast(`수집 실패 (${s.conclusion})`, 5000);
      }
      return;
    }
  }
  showToast('수집이 예상보다 오래 걸립니다. 잠시 후 새로고침해 주세요.', 5000);
}

async function pollUpdate(startMs) {
  while (true) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch('/api/update/status', { cache: 'no-store' });
    const s = await res.json();
    const elapsed = Math.floor((Date.now() - startMs) / 1000);
    if (s.running) {
      const phase = PHASE_LABEL[s.phase] || '실행 중';
      $('#refreshLabel').textContent = `${phase} ${elapsed}s`;
      const tail = (s.logTail || []).filter((l) => !l.startsWith('[err]')).slice(-1)[0];
      if (tail) showToast(tail.replace(/^\[[^\]]+\]\s*/, ''), 3000);
    } else {
      return { ...s, elapsed };
    }
  }
}

$('#refreshBtn').addEventListener('click', async () => {
  const btn = $('#refreshBtn');
  const label = $('#refreshLabel');
  const originalText = label.textContent;
  btn.disabled = true;
  btn.classList.add('spinning');
  const start = Date.now();

  // 순위·뉴스는 서버의 리뷰 수집 파이프라인(/api/update) 대상이 아니다.
  // 그대로 두면 뉴스 화면에서 누른 버튼이 네이버 리뷰 수집을 돌리게 되므로 다시 불러오기만 한다.
  if (currentSource === 'rank' || currentSource === 'news') {
    label.textContent = '불러오는 중...';
    try {
      await load();
      showToast('데이터를 다시 불러왔습니다 (수집은 매일 자동 실행)', 3000);
    } catch (e) {
      showToast(`로드 실패: ${e.message}`, 4000);
    } finally {
      label.textContent = originalText;
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
    return;
  }

  // GitHub Pages 등 백엔드가 없는 환경
  if (!HAS_BACKEND) {
    try {
      if (TRIGGER_WORKER_URL) {
        await runRemoteUpdate(label, originalText);
      } else {
        label.textContent = '불러오는 중...';
        await load();
        showToast('데이터를 다시 불러왔습니다 (실제 수집은 매일 자동 실행)', 3500);
      }
    } catch (e) {
      showToast(`실패: ${e.message}`, 4000);
    } finally {
      label.textContent = originalText;
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
    return;
  }

  // 로컬 Node 서버 환경: 실제 스크래퍼 실행
  label.textContent = '시작 중...';
  try {
    const res = await fetch(`/api/update?source=${currentSource}`, { method: 'POST' });
    if (res.status === 409) {
      showToast('이미 업데이트가 진행 중입니다', 3000);
    } else if (!res.ok) {
      throw new Error(`서버 응답 ${res.status}`);
    } else {
      showToast('네이버에서 최신 리뷰 가져오는 중... (1~2분)', 4000);
    }
    const final = await pollUpdate(start);
    if (final.ok) {
      await load();
      showToast(`업데이트 완료 · ${final.elapsed}초 소요`, 3000);
    } else {
      showToast(`업데이트 실패: ${final.message || '알 수 없는 오류'}`, 5000);
    }
  } catch (e) {
    showToast(`오류: ${e.message}`, 5000);
  } finally {
    label.textContent = originalText;
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
});

function switchSource(source) {
  if (source === currentSource) return;
  currentSource = source;
  document.querySelectorAll('.nav-item[data-source]').forEach((el) => {
    el.classList.toggle('active', el.dataset.source === source);
  });
  $('#pageTitle').textContent = SOURCE_PAGE_TITLE[source] || '리뷰 모니터링';
  load().catch((err) => showToast(`로드 실패: ${err.message}`, 4000));
}

document.querySelectorAll('.nav-item[data-source]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    switchSource(el.dataset.source);
  });
});

if (window.lucide) window.lucide.createIcons();

load().catch((err) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="error-banner">데이터 로드 실패: ${escapeHtml(err.message)}<br>먼저 <code>npm run update</code>를 실행해 <code>data/summary.json</code>을 생성하세요.</div>`
  );
});
