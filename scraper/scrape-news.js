/**
 * '라운지엑스' 브랜드 기사 수집
 *
 * 수집원 2개를 합쳐서 사용:
 *  1) 구글 뉴스 RSS — 인증 불필요, <source> 로 언론사명까지 제공. 기본 수집원.
 *  2) 네이버 뉴스 검색 API — 키가 있고 앱에 '검색' API 가 등록돼 있을 때만 동작.
 *     (데이터랩 키만 등록된 상태면 401 "Scope Status Invalid" 가 나므로 조용히 건너뛴다)
 *
 * 기사는 시간이 지나면 검색 결과에서 밀려나므로 제목 기준 dedup 으로 누적한다.
 * 공개 정보라 캐시 대신 data/news.json 을 커밋해 그 파일 자체를 누적 저장소로 쓴다.
 *
 * 기사마다 scope('brand' = 라운지엑스 직접 언급 / 'operator' = 운영사 기사)를 붙여두고,
 * 월별·언론사별·주제어 집계는 대시보드가 선택된 scope 로 직접 계산한다
 * (토글 즉시 반응 + 집계 기준이 한 군데에만 존재).
 */
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'data', 'news.json');
const GOOGLE_RSS = 'https://news.google.com/rss/search';
const NAVER_API = 'https://openapi.naver.com/v1/search/news.json';
const NAVER_DISPLAY = 100;
const NAVER_MAX_START = 1000; // API 상한 (start + display <= 1000)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 브랜드 표기 흔들림을 커버. 결과는 제목 기준으로 합쳐진다.
// 라운지랩=구 사명, 엑스와이지=현 사명 — 매장 브랜드 기사가 이 이름으로도 나온다
const QUERIES = ['라운지엑스', '라운지엑스24h', '라운지X 로봇카페', '라운지랩', '엑스와이지 로봇', 'loungex 카페'];

// 검색 결과에는 '라운지'+'엑스'가 따로 걸린 무관 기사(롯데면세점 스타라운지, 펀디엑스 등)가 섞인다.
// 제목·요약에 아래 표기가 실제로 등장하는 기사만 남긴다.
//  brand    = 매장 브랜드 '라운지엑스' 를 직접 언급한 기사
//  operator = 운영사(라운지랩=구 사명, 엑스와이지=현 사명) 기사. 브랜드 기사가 이 이름으로 나오기도 해서
//             버리진 않지만, 대시보드에서 기본으로는 브랜드 기사만 보여준다
const BRAND_TOKENS = ['라운지엑스', '라운지x', 'loungex'];
const OPERATOR_TOKENS = ['라운지랩', 'loungelab', '엑스와이지'];
const normalize = (a) => `${a.title} ${a.description || ''}`.toLowerCase().replace(/[\s'’·]+/g, '');
const scopeOf = (a) => {
  const t = normalize(a);
  if (BRAND_TOKENS.some((tok) => t.includes(tok))) return 'brand';
  if (OPERATOR_TOKENS.some((tok) => t.includes(tok))) return 'operator';
  return null; // 무관 기사
};

// 네이버 API 는 언론사명을 주지 않아 originallink 도메인으로 판별한다
const PRESS_BY_DOMAIN = {
  'chosun.com': '조선일보', 'biz.chosun.com': '조선비즈', 'donga.com': '동아일보',
  'joongang.co.kr': '중앙일보', 'joins.com': '중앙일보', 'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문', 'seoul.co.kr': '서울신문', 'hankookilbo.com': '한국일보',
  'mk.co.kr': '매일경제', 'hankyung.com': '한국경제', 'sedaily.com': '서울경제',
  'edaily.co.kr': '이데일리', 'fnnews.com': '파이낸셜뉴스', 'mt.co.kr': '머니투데이',
  'asiae.co.kr': '아시아경제', 'heraldcorp.com': '헤럴드경제', 'etnews.com': '전자신문',
  'zdnet.co.kr': '지디넷코리아', 'dt.co.kr': '디지털타임스', 'inews24.com': '아이뉴스24',
  'bloter.net': '블로터', 'venturesquare.net': '벤처스퀘어', 'platum.kr': '플래텀',
  'thebell.co.kr': '더벨', 'newspim.com': '뉴스핌', 'newsis.com': '뉴시스',
  'yna.co.kr': '연합뉴스', 'news1.kr': '뉴스1', 'ajunews.com': '아주경제',
  'kmib.co.kr': '국민일보', 'segye.com': '세계일보', 'munhwa.com': '문화일보',
  'ohmynews.com': '오마이뉴스', 'nocutnews.co.kr': 'CBS노컷뉴스', 'sbs.co.kr': 'SBS',
  'kbs.co.kr': 'KBS', 'imbc.com': 'MBC', 'ytn.co.kr': 'YTN', 'jtbc.co.kr': 'JTBC',
  'mbn.co.kr': 'MBN', 'wowtv.co.kr': '한국경제TV', 'businesspost.co.kr': '비즈니스포스트',
  'theguru.co.kr': '더구루', 'startupn.kr': '스타트업엔', 'techm.kr': '테크M',
  'dailian.co.kr': '데일리안', 'ddaily.co.kr': '디지털데일리', 'newsway.co.kr': '뉴스웨이',
  'kukinews.com': '쿠키뉴스', 'wikitree.co.kr': '위키트리', 'insight.co.kr': '인사이트',
  'tf.co.kr': '더팩트', 'g-enews.com': '글로벌이코노믹', 'ilyosisa.co.kr': '일요시사',
};

const log = (...a) => console.log(`[news ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

const unwrapCdata = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();

// pubDate → KST 기준 YYYY-MM-DD
function kstDate(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// dedup 키: 같은 기사가 수집원마다 다른 URL 로 오므로 링크가 아니라 제목으로 묶는다.
// \W 를 쓰면 한글까지 지워져 제목이 통째로 빈 문자열이 되므로 유니코드 속성으로 문자·숫자만 남긴다
const titleKey = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function pressFromDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (PRESS_BY_DOMAIN[host]) return PRESS_BY_DOMAIN[host];
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

// ── 구글 뉴스 RSS ────────────────────────────────────────────
async function collectGoogle(query) {
  const url = `${GOOGLE_RSS}?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`구글 뉴스 RSS ${res.status}`);
  const xml = await res.text();
  const items = xml.split('<item>').slice(1);
  const out = [];
  for (const raw of items) {
    const pick = (re) => decodeEntities(unwrapCdata((raw.match(re) || [])[1] || ''));
    const rawTitle = pick(/<title>([\s\S]*?)<\/title>/);
    const press = pick(/<source[^>]*>([\s\S]*?)<\/source>/);
    // 구글 뉴스 제목은 "기사 제목 - 언론사" 형식이라 꼬리를 떼어낸다
    const title = press && rawTitle.endsWith(` - ${press}`)
      ? rawTitle.slice(0, -(press.length + 3)).trim()
      : rawTitle;
    if (!title) continue;
    out.push({
      title,
      description: '',
      link: pick(/<link>([\s\S]*?)<\/link>/),
      press: press || '기타',
      date: kstDate(pick(/<pubDate>([\s\S]*?)<\/pubDate>/)),
      source: 'google',
    });
  }
  log(`구글 뉴스 '${query}' → ${out.length}건`);
  return out;
}

// ── 네이버 뉴스 검색 API (선택) ──────────────────────────────
async function collectNaver(query, id, secret) {
  const out = [];
  for (let start = 1; start + NAVER_DISPLAY - 1 <= NAVER_MAX_START; start += NAVER_DISPLAY) {
    const url = `${NAVER_API}?query=${encodeURIComponent(query)}&display=${NAVER_DISPLAY}&start=${start}&sort=date`;
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${t.slice(0, 120)}`);
    }
    const json = await res.json();
    const batch = json.items || [];
    for (const it of batch) {
      const link = it.originallink || it.link;
      const title = decodeEntities(it.title);
      if (!title || !link) continue;
      out.push({
        title,
        description: decodeEntities(it.description),
        link,
        press: pressFromDomain(link),
        date: kstDate(it.pubDate),
        source: 'naver',
      });
    }
    if (batch.length < NAVER_DISPLAY) break;
    await sleep(120);
  }
  log(`네이버 뉴스 '${query}' → ${out.length}건`);
  return out;
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(OUT_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { articles: [] }; throw e; }
}

function dedupe(prev, fresh, runIso) {
  const byKey = new Map(prev.map((a) => [titleKey(a.title), a]));
  let added = 0;
  for (const a of fresh) {
    const key = titleKey(a.title);
    if (!key) continue;
    const hit = byKey.get(key);
    if (!hit) {
      byKey.set(key, { ...a, firstSeenAt: runIso });
      added++;
      continue;
    }
    // 이미 있는 기사면 더 나은 정보로 보강 — 네이버 쪽 요약과 원문 링크가 더 유용하다
    if (!hit.description && a.description) hit.description = a.description;
    if (hit.source === 'google' && a.source === 'naver') {
      hit.link = a.link;
      hit.press = a.press;
      hit.source = 'naver';
    }
    if (!hit.date && a.date) hit.date = a.date;
  }
  return { merged: [...byKey.values()], added };
}

async function main() {
  const fresh = [];

  for (const q of QUERIES) {
    try {
      fresh.push(...(await collectGoogle(q)));
    } catch (e) {
      log(`구글 뉴스 '${q}' 실패: ${e.message}`);
    }
    await sleep(300);
  }

  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (id && secret) {
    for (const q of QUERIES) {
      try {
        fresh.push(...(await collectNaver(q, id, secret)));
      } catch (e) {
        // 앱에 '검색' API 가 등록 안 된 흔한 케이스 — 구글 결과는 살리고 넘어간다
        log(`네이버 뉴스 '${q}' 스킵: ${e.message}`);
        break;
      }
      await sleep(200);
    }
  } else {
    log('NAVER_CLIENT_ID/SECRET 없음 — 네이버 뉴스는 건너뜀 (구글 뉴스만 수집)');
  }

  if (fresh.length === 0) {
    log('수집된 기사 없음 — 기존 파일 유지');
    return;
  }

  const relevant = fresh.filter((a) => scopeOf(a));
  log(`관련 기사 ${relevant.length}건 / 검색 결과 ${fresh.length}건 (브랜드·운영사 미언급 ${fresh.length - relevant.length}건 제외)`);

  const existing = await loadExisting();
  const runIso = new Date().toISOString();
  const { merged, added } = dedupe(existing.articles || [], relevant, runIso);

  // scope 는 제목·요약에서 매번 다시 계산한다 — 판정 규칙을 고쳐도 기존 누적분이 알아서 갱신됨
  for (const a of merged) a.scope = scopeOf(a);
  const articles = merged
    .filter((a) => a.scope)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const brandCount = articles.filter((a) => a.scope === 'brand').length;
  const out = {
    lastScrapedAt: runIso,
    queries: QUERIES,
    totalArticles: articles.length,
    brandArticles: brandCount,
    operatorArticles: articles.length - brandCount,
    articles,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  log(`저장 완료: 누적 ${articles.length}건 (신규 +${added}건 · 브랜드 ${brandCount} / 운영사 ${articles.length - brandCount}) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('뉴스 수집 오류:', err.message);
  process.exit(0); // 비차단
});
