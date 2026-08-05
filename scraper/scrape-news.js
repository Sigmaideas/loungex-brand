/**
 * 네이버 뉴스 검색 API 로 '라운지엑스' 브랜드 기사 수집
 *
 * - 검색어별로 최신순 수집 → link 기준 dedup 누적 (기사는 시간이 지나면 검색에서 밀려남)
 * - 언론사는 originallink 도메인으로 판별 (API 가 언론사명을 주지 않음)
 * - 집계(월별/언론사별/주제어)까지 한 파일에 담아 data/news.json 저장
 *   → 리뷰와 달리 기사는 공개 정보라 원문 링크째로 커밋해도 무방
 *
 * 필요: 환경변수 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (트렌드 수집과 동일 키)
 * 없으면 조용히 스킵(파이프라인 비차단)
 */
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'data', 'news.json');
const API_URL = 'https://openapi.naver.com/v1/search/news.json';
const DISPLAY = 100; // 페이지당 최대치
const MAX_START = 1000; // API 상한 (start + display <= 1000)
const RECENT_LIMIT = 80; // 대시보드 표에 넘길 최근 기사 수

// 브랜드 표기 흔들림을 모두 커버. 결과는 link 기준으로 합쳐짐
const QUERIES = ['라운지엑스', '라운지엑스24h', 'loungex'];

// 기사 본문/제목에서 잡아낼 주제어. 리뷰용 KEYWORD_GROUPS 는 카페 리뷰 전용이라 뉴스에는 부적합
const TOPIC_GROUPS = [
  { label: '로봇·자동화', terms: ['로봇', '자동화', '바리스타로봇', '무인'] },
  { label: '투자·유치', terms: ['투자', '유치', '시리즈', '펀딩', '라운드'] },
  { label: '신규 매장·출점', terms: ['오픈', '출점', '신규 매장', '입점', '개점', '매장 확대'] },
  { label: 'AI·기술', terms: ['ai', '인공지능', '기술', '특허', '알고리즘'] },
  { label: '프랜차이즈·가맹', terms: ['프랜차이즈', '가맹', '창업'] },
  { label: '수상·선정', terms: ['수상', '선정', '어워드', '대상', '우수'] },
  { label: '제휴·협업', terms: ['제휴', '협업', '협약', 'mou', '파트너'] },
  { label: '해외·수출', terms: ['해외', '수출', '글로벌', '진출'] },
  { label: '매출·실적', terms: ['매출', '실적', '흑자', '성장률'] },
  { label: '카페·커피', terms: ['카페', '커피', '원두', '음료'] },
  { label: '디저트·베이커리', terms: ['디저트', '베이커리', '케이크', '빵'] },
  { label: '푸드테크', terms: ['푸드테크', '외식', '식음료', 'f&b'] },
];
const TOPIC_TOP_N = 12;

// originallink 도메인 → 언론사명. 없으면 호스트명을 그대로 노출
const PRESS_BY_DOMAIN = {
  'chosun.com': '조선일보', 'biz.chosun.com': '조선비즈', 'donga.com': '동아일보',
  'joongang.co.kr': '중앙일보', 'joins.com': '중앙일보', 'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문', 'seoul.co.kr': '서울신문', 'hankookilbo.com': '한국일보',
  'mk.co.kr': '매일경제', 'hankyung.com': '한국경제', 'sedaily.com': '서울경제',
  'edaily.co.kr': '이데일리', 'fnnews.com': '파이낸셜뉴스', 'mt.co.kr': '머니투데이',
  'asiae.co.kr': '아시아경제', 'heraldcorp.com': '헤럴드경제', 'etnews.com': '전자신문',
  'zdnet.co.kr': 'ZDNet코리아', 'dt.co.kr': '디지털타임스', 'inews24.com': '아이뉴스24',
  'bloter.net': '블로터', 'venturesquare.net': '벤처스퀘어', 'platum.kr': '플래텀',
  'thebell.co.kr': '더벨', 'newspim.com': '뉴스핌', 'newsis.com': '뉴시스',
  'yna.co.kr': '연합뉴스', 'yonhapnews.co.kr': '연합뉴스', 'news1.kr': '뉴스1',
  'ajunews.com': '아주경제', 'kmib.co.kr': '국민일보', 'segye.com': '세계일보',
  'munhwa.com': '문화일보', 'imaeil.com': '매일신문', 'ohmynews.com': '오마이뉴스',
  'pressian.com': '프레시안', 'nocutnews.co.kr': 'CBS노컷뉴스', 'sbs.co.kr': 'SBS',
  'kbs.co.kr': 'KBS', 'imbc.com': 'MBC', 'ytn.co.kr': 'YTN', 'jtbc.co.kr': 'JTBC',
  'mbn.co.kr': 'MBN', 'wowtv.co.kr': '한국경제TV', 'businesspost.co.kr': '비즈니스포스트',
  'theguru.co.kr': '더구루', 'ceoscoredaily.com': 'CEO스코어데일리',
  'foodbank.co.kr': '식품외식경제', 'thescoop.co.kr': '더스쿠프',
  'startupn.kr': '스타트업엔', 'besuccess.com': '비석세스', 'techm.kr': '테크M',
  'dailian.co.kr': '데일리안', 'ddaily.co.kr': '디지털데일리', 'newsway.co.kr': '뉴스웨이',
  'sisajournal.com': '시사저널', 'weekly.chosun.com': '주간조선', 'ilyo.co.kr': '일요신문',
  'kukinews.com': '쿠키뉴스', 'moneys.co.kr': '머니S', 'wikitree.co.kr': '위키트리',
  'insight.co.kr': '인사이트', 'tf.co.kr': '더팩트', 'g-enews.com': '글로벌이코노믹',
  'consumernews.co.kr': '컨슈머타임스', 'ekn.kr': '에너지경제', 'metroseoul.co.kr': '메트로신문',
};

const log = (...a) => console.log(`[news ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// API 가 돌려주는 제목/요약에는 <b> 강조 태그와 HTML 엔티티가 섞여 있다
function cleanText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .trim();
}

// pubDate("Mon, 04 Aug 2026 09:00:00 +0900") → KST 기준 YYYY-MM-DD
function kstDate(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function pressOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (PRESS_BY_DOMAIN[host]) return PRESS_BY_DOMAIN[host];
    // news.chosun.com 처럼 서브도메인이 붙은 경우 상위 도메인으로 한 번 더 시도
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const base = parts.slice(i).join('.');
      if (PRESS_BY_DOMAIN[base]) return PRESS_BY_DOMAIN[base];
    }
    return host;
  } catch {
    return '기타';
  }
}

async function fetchPage(query, start, id, secret) {
  const url = `${API_URL}?query=${encodeURIComponent(query)}&display=${DISPLAY}&start=${start}&sort=date`;
  const res = await fetch(url, {
    headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`뉴스 검색 API ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function collect(query, id, secret) {
  const items = [];
  let total = 0;
  for (let start = 1; start <= MAX_START; start += DISPLAY) {
    if (start + DISPLAY - 1 > MAX_START) break;
    const json = await fetchPage(query, start, id, secret);
    total = json.total || 0;
    const batch = json.items || [];
    items.push(...batch);
    if (batch.length < DISPLAY) break; // 마지막 페이지
    await sleep(120);
  }
  log(`'${query}' → 수집 ${items.length}건 (API 전체 ${total.toLocaleString()}건)`);
  return { items, total };
}

function mapArticle(it) {
  const link = it.originallink || it.link;
  return {
    title: cleanText(it.title),
    description: cleanText(it.description),
    link,
    naverLink: it.link || null,
    press: pressOf(link),
    date: kstDate(it.pubDate),
  };
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(OUT_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { articles: [] }; throw e; }
}

function dedupe(prev, fresh, runIso) {
  const seen = new Set(prev.map((a) => a.link));
  const out = [...prev];
  let added = 0;
  for (const a of fresh) {
    if (!a.link || seen.has(a.link)) continue;
    seen.add(a.link);
    out.push({ ...a, firstSeenAt: runIso });
    added++;
  }
  return { merged: out, added };
}

function aggregate(articles) {
  const dated = articles.filter((a) => a.date);

  // 월별 기사 수 (연도별 12칸 배열) — 리뷰 대시보드의 monthlySentimentByYear 와 같은 형태
  const monthlyByYear = {};
  for (const a of dated) {
    const [y, m] = a.date.split('-');
    if (!monthlyByYear[y]) monthlyByYear[y] = Array.from({ length: 12 }, () => 0);
    monthlyByYear[y][Number(m) - 1]++;
  }
  const availableYears = Object.keys(monthlyByYear).map(Number).sort((a, b) => b - a);

  const pressCount = new Map();
  for (const a of articles) pressCount.set(a.press, (pressCount.get(a.press) || 0) + 1);
  const pressBreakdown = [...pressCount.entries()]
    .map(([press, count]) => ({ press, count }))
    .sort((a, b) => b.count - a.count);

  const topics = TOPIC_GROUPS.map((g) => ({ word: g.label, count: 0 }));
  for (const a of articles) {
    const text = `${a.title} ${a.description}`.toLowerCase();
    TOPIC_GROUPS.forEach((g, i) => {
      if (g.terms.some((t) => text.includes(t))) topics[i].count++;
    });
  }
  const topicFrequency = topics.filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, TOPIC_TOP_N);

  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const monthlyActivity = dated.filter((a) => a.date >= cutoff).length;

  const sorted = [...dated].sort((a, b) => b.date.localeCompare(a.date));

  return {
    totalArticles: articles.length,
    monthlyActivity,
    pressCount: pressCount.size,
    latestArticleDate: sorted[0]?.date || null,
    monthlyByYear,
    availableYears,
    pressBreakdown,
    topicFrequency,
    recentArticles: sorted.slice(0, RECENT_LIMIT),
  };
}

async function main() {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    log('NAVER_CLIENT_ID/SECRET 없음 — 뉴스 수집 스킵');
    return;
  }

  const fresh = [];
  let apiTotal = 0;
  for (const q of QUERIES) {
    const { items, total } = await collect(q, id, secret);
    fresh.push(...items.map(mapArticle));
    apiTotal = Math.max(apiTotal, total);
    await sleep(200);
  }

  const existing = await loadExisting();
  const runIso = new Date().toISOString();
  const { merged, added } = dedupe(existing.articles || [], fresh, runIso);

  const out = {
    lastScrapedAt: runIso,
    queries: QUERIES,
    apiTotal,
    ...aggregate(merged),
    articles: merged,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  log(`저장 완료: 누적 ${merged.length}건 (신규 +${added}건, 언론사 ${out.pressCount}곳) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('뉴스 수집 오류:', err.message);
  process.exit(0); // 비차단
});
