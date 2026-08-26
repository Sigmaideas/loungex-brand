/**
 * 네이버 블로그 '라운지엑스' 언급 포스트 수집
 *
 * 네이버 검색 API 는 쓰지 않는다 — 발급된 키가 '검색' 스코프 미등록이라 401 이 난다.
 * 대신 통합검색의 블로그 탭을 훑는다. 이 탭은 서버가 결과를 HTML 에 담아 내려주므로
 * 브라우저(Playwright) 없이 fetch 만으로 충분하다 — 같은 일을 하는 xyz-brand 쪽보다 훨씬 가볍다.
 *
 * 검색 결과 HTML 은 클래스명이 난독화돼 있어 바뀌기 쉬우므로,
 * 상대적으로 안정적인 data-template-id 속성과 blog.naver.com URL 패턴으로만 뽑는다.
 *
 * 포스트는 시간이 지나면 검색 결과에서 밀려나므로 URL 기준 dedup 으로 누적한다.
 * 공개 정보라 캐시 대신 data/blog.json 을 커밋해 그 파일 자체를 누적 저장소로 쓴다.
 *
 * '3일 전' 같은 상대 표기는 수집 시점에 절대 날짜로 바꿔 저장한다 — 그대로 두면 의미가 변한다.
 */
const fs = require('fs').promises;
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'data', 'blog.json');
const SEARCH_URL = 'https://search.naver.com/search.naver';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGES_PER_QUERY = 4; // 한 페이지 30건 → 쿼리당 최대 120건
const PAGE_SIZE = 30;
const FETCH_TIMEOUT_MS = 15000;

// 표기 흔들림 커버. 결과는 포스트 URL 기준으로 합쳐진다
const QUERIES = ['라운지엑스', '라운지엑스24h', '라운지엑스 로봇카페', '라운지엑스 후기'];

// 공식 채널은 따로 구분한다 — 자사 홍보글과 외부 언급을 섞으면 지표가 왜곡된다
// (lounge_lab = 구 라운지랩, xyz_inc = 운영사 엑스와이지)
const OFFICIAL_BLOG_IDS = ['loungex_official', 'lounge_lab', 'xyz_inc'];
// 브랜드 전용 블로그는 글마다 브랜드명을 안 써도 전부 라운지엑스 글이다 →
// 아래 맥락 조건을 면제한다. 운영사 블로그(xyz_inc)는 로봇 사업 글이 섞이므로 제외
const BRAND_BLOG_IDS = ['loungex_official'];

// 공백·문장부호를 지우고 비교한다 ('라운지 엑스' → '라운지엑스')
const normalize = (p) =>
  `${p.title} ${p.description || ''}`
    .toLowerCase()
    .replace(/[\s'’"“”·,()\[\]|/\-_]+/g, '');

const BRAND_TOKENS = ['라운지엑스', '라운지x', 'loungex'];
// 브랜드 표기만으로는 못 거르는 것들:
//   '라운지엑스포'(전시회) · 공항/호텔 라운지 후기 · 라운지엑스레이(의료)
const EXCLUDE = ['라운지엑스포', '공항라운지', '호텔라운지', '라운지엑스레이'];
// 카페 맥락이 같이 있어야 실제 방문·언급 글로 본다
const ANCHORS = ['카페', '커피', '로봇', '바리스타', '무인', '24시', '디저트', '아이스크림',
  '베이커리', '음료', '매장', '후기', '창업', '가맹'];

function isRelevant(p) {
  const t = normalize(p);
  if (EXCLUDE.some((x) => t.includes(x))) return false;
  if (BRAND_BLOG_IDS.includes(p.bloggerId)) return true;
  if (!BRAND_TOKENS.some((x) => t.includes(x))) return false;
  return ANCHORS.some((x) => t.includes(x));
}

const log = (...a) => console.log(`[blog ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// KST 기준 YYYY-MM-DD
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const shiftDays = (days) =>
  new Date(Date.now() + 9 * 3600 * 1000 - days * 86400 * 1000).toISOString().slice(0, 10);

// 네이버는 '2026.03.10.' 같은 절대 표기와 '3일 전' 같은 상대 표기를 섞어 쓴다.
// 상대 표기는 수집 시점 기준으로 절대 날짜로 환산한다(근사값이라도 월별 집계엔 충분).
function parseDate(raw) {
  const s = String(raw || '').trim();
  const abs = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (abs) {
    const [, y, m, d] = abs;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^(오늘|방금 전|\d+\s*(분|시간)\s*전)$/.test(s)) return kstToday();
  if (/^어제$/.test(s)) return shiftDays(1);
  const rel = s.match(/^(\d+)\s*(일|주|개월|년)\s*전$/);
  if (rel) {
    const n = Number(rel[1]);
    const per = { 일: 1, 주: 7, 개월: 30, 년: 365 }[rel[2]];
    return shiftDays(n * per);
  }
  return null;
}

const decodeEntities = (s) =>
  String(s || '')
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

// 태그를 걷어내고 스크린리더 전용 문구를 지운다
const strip = (s) =>
  decodeEntities(String(s || '').replace(/<[^>]*>/g, ' '))
    .replace(/새 창 열림|Keep에 저장/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const POST_RE = /^https:\/\/blog\.naver\.com\/([^/?#"]+)\/(\d+)/;

// 검색 결과 한 페이지에서 포스트를 뽑는다.
// data-template-id="ugcItem" 이 항목 경계라 그 기준으로 잘라 항목별로 파싱한다
function extractItems(html) {
  return html
    .split('data-template-id="ugcItem"')
    .slice(1)
    .map((seg) => {
      const anchors = [...seg.matchAll(/<a[^>]*href="(https:\/\/blog\.naver\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
        .filter((a) => POST_RE.test(a[1]));
      if (!anchors.length) return null;
      const m = anchors[0][1].match(POST_RE);
      // 첫 앵커가 제목, 두 번째가 본문 미리보기 (썸네일만 있는 경우 본문은 비어 있다)
      const texts = anchors.map((a) => strip(a[2])).filter(Boolean);
      // 작성자 블록. 클래스명 끝의 따옴표까지 붙여야 컨테이너(...-subtexts)가 아니라
      // 날짜 span 이 잡힌다
      const blogger = strip((seg.match(/profile-info-title-text[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
      const rawDate = strip((seg.match(/sds-comps-profile-info-subtext"[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
      // 항목의 첫 이미지는 블로거 프로필 사진(blogpfthumb)이라 건너뛰고,
      // 본문 이미지(blogfiles) 중 첫 장을 대표 썸네일로 쓴다
      const image = [...seg.matchAll(/<img[^>]+src="([^"]+)"/g)]
        .map((x) => decodeEntities(x[1]))
        .find((u) => u.includes('blogfiles.naver.net')) || null;
      return {
        link: `https://blog.naver.com/${m[1]}/${m[2]}`,
        bloggerId: m[1],
        title: texts[0] || '',
        description: texts[1] || '',
        blogger: blogger || m[1],
        image,
        rawDate,
      };
    })
    .filter((x) => x && x.title);
}

async function collect(query) {
  const out = [];
  for (let i = 0; i < PAGES_PER_QUERY; i++) {
    const start = i * PAGE_SIZE + 1;
    // nso=so:dd → 최신순. 관련도순이면 오래된 글이 위로 올라와 신규 수집이 안 된다
    const url = `${SEARCH_URL}?ssc=tab.blog.all&query=${encodeURIComponent(query)}&nso=so%3Add%2Cp%3Aall&start=${start}`;
    let items;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = extractItems(await res.text());
    } catch (e) {
      log(`'${query}' ${start}번째 페이지 실패: ${e.message}`);
      break;
    }
    if (!items.length) break; // 결과 없음 = 마지막 페이지
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
    await sleep(700);
  }
  const posts = out.map((p) => ({
    title: p.title,
    description: p.description,
    link: p.link,
    blogger: p.blogger || p.bloggerId,
    bloggerId: p.bloggerId,
    image: p.image,
    date: parseDate(p.rawDate),
    official: OFFICIAL_BLOG_IDS.includes(p.bloggerId),
  }));
  log(`'${query}' → ${posts.length}건`);
  return posts;
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(OUT_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { posts: [] }; throw e; }
}

function dedupe(prev, fresh, runIso) {
  const byLink = new Map(prev.map((p) => [p.link, p]));
  let added = 0;
  for (const p of fresh) {
    const hit = byLink.get(p.link);
    if (!hit) {
      byLink.set(p.link, { ...p, firstSeenAt: runIso });
      added++;
      continue;
    }
    // 이미 있으면 빈 칸만 보강한다. date 는 먼저 잡은 값이 실제 작성일에 가깝다
    // (상대 표기를 뒤늦게 다시 환산하면 날짜가 뒤로 밀린다)
    if (!hit.description && p.description) hit.description = p.description;
    if (!hit.image && p.image) hit.image = p.image;
    if (!hit.date && p.date) hit.date = p.date;
  }
  return { merged: [...byLink.values()], added };
}

async function main() {
  const fresh = [];
  for (const q of QUERIES) {
    try {
      fresh.push(...(await collect(q)));
    } catch (e) {
      log(`'${q}' 실패: ${e.message}`);
    }
    await sleep(900);
  }

  if (!fresh.length) {
    log('수집된 포스트 없음 — 기존 파일 유지');
    return;
  }

  const relevant = fresh.filter(isRelevant);
  log(`관련 포스트 ${relevant.length}건 / 검색 결과 ${fresh.length}건 (무관 ${fresh.length - relevant.length}건 제외)`);

  const existing = await loadExisting();
  const runIso = new Date().toISOString();
  const { merged, added } = dedupe(existing.posts || [], relevant, runIso);

  // 관련성·공식 판정은 매번 다시 돌린다 — 규칙을 고치면 기존 누적분도 함께 정리된다
  const posts = merged
    .filter(isRelevant)
    .map((p) => ({ ...p, official: OFFICIAL_BLOG_IDS.includes(p.bloggerId) }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const officialCount = posts.filter((p) => p.official).length;
  const out = {
    lastScrapedAt: runIso,
    queries: QUERIES,
    totalPosts: posts.length,
    officialPosts: officialCount,
    externalPosts: posts.length - officialCount,
    bloggerCount: new Set(posts.map((p) => p.bloggerId)).size,
    posts,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  log(`저장 완료: 누적 ${posts.length}건 (신규 +${added}건 · 공식 ${officialCount} / 외부 ${posts.length - officialCount}) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('블로그 수집 오류:', err.message);
  process.exit(0); // 비차단
});
