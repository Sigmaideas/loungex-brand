/**
 * 유튜브 '라운지엑스' 언급 영상 수집
 *
 * YouTube Data API 는 쓰지 않는다 — 키 발급/할당량 없이 돌리기 위해
 * 검색 결과 페이지에 통째로 박혀 오는 ytInitialData(JSON)를 파싱한다.
 * 클래스명이 아니라 JSON 구조(videoRenderer)에 의존하므로 화면 개편에는 비교적 강하다.
 *
 * 2단계로 나뉜다:
 *  1) 검색 — 쿼리별로 영상 목록을 훑는다. 제목·채널·썸네일·요약이 여기서 나온다.
 *  2) 상세 — 영상 페이지에서 정확한 업로드일과 조회수를 읽는다.
 *     검색 결과의 '7개월 전', '조회수 1.1만회' 는 근사값이라 월별 집계·조회수 합계에 못 쓴다.
 *     조회수는 계속 변하므로 매 실행 갱신하고, 상한(DETAIL_PER_RUN)을 둬 신규 영상을 먼저 본다.
 *
 * 영상은 시간이 지나면 검색 결과에서 밀려나므로 videoId 기준 dedup 으로 누적한다.
 * 공개 정보라 캐시 대신 data/youtube.json 을 커밋해 그 파일 자체를 누적 저장소로 쓴다.
 */
const fs = require('fs').promises;
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'data', 'youtube.json');
const SEARCH_URL = 'https://www.youtube.com/results';
const WATCH_URL = 'https://www.youtube.com/watch';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DETAIL_PER_RUN = 60; // 한 실행에서 영상 페이지를 열 최대 건수
const FETCH_TIMEOUT_MS = 15000;

// 표기 흔들림 커버. 결과는 videoId 기준으로 합쳐진다
const QUERIES = [
  '라운지엑스',
  '라운지엑스24h',
  '라운지엑스 로봇카페',
  '로봇카페 라운지엑스',
  'loungex robot cafe',
];

// 공식 채널은 따로 구분한다 — 자사 홍보 영상과 외부 언급을 섞으면 지표가 왜곡된다
const OFFICIAL_CHANNEL_IDS = ['UCFQFu4sQC1dRfZVzS8HBljw']; // 카페 라운지엑스24

// 공백·문장부호를 지우고 비교한다 ('라운지 엑스' → '라운지엑스')
const normalize = (v) =>
  `${v.title} ${v.description || ''} ${v.channel || ''}`
    .toLowerCase()
    .replace(/[\s'’"“”·,()\[\]|/\-_]+/g, '');

const BRAND_TOKENS = ['라운지엑스', '라운지x', 'loungex', 'ラウンジエックス'];
// 브랜드 표기만으로는 못 거르는 것들:
//   '라운지엑스포'(전시회) · 아디다스 LOUNGE X · 공항/호텔 라운지
const EXCLUDE = ['라운지엑스포', 'adidas', 'ultraboost', '공항라운지', '호텔라운지'];
// 로봇/카페 맥락이 같이 있어야 실제 브랜드 영상으로 본다
const ANCHORS = ['로봇', '카페', '커피', '바리스타', '무인', '24시', '디저트', '아이스크림',
  '창업', 'robot', 'cafe', 'coffee', 'barista'];

function isRelevant(v) {
  const t = normalize(v);
  if (EXCLUDE.some((x) => t.includes(x))) return false;
  if (OFFICIAL_CHANNEL_IDS.includes(v.channelId)) return true;
  if (!BRAND_TOKENS.some((x) => t.includes(x))) return false;
  return ANCHORS.some((x) => t.includes(x));
}

const log = (...a) => console.log(`[youtube ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// KST 기준 YYYY-MM-DD
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const shiftDays = (days) =>
  new Date(Date.now() + 9 * 3600 * 1000 - days * 86400 * 1000).toISOString().slice(0, 10);

// 검색 결과의 상대 표기('7개월 전')를 절대 날짜로 환산한다.
// 어디까지나 임시값 — 상세 단계에서 정확한 업로드일로 덮어쓴다
function parseRelativeDate(raw) {
  const s = String(raw || '').trim();
  if (/^(방금|오늘)/.test(s)) return kstToday();
  const m = s.match(/^(\d+)\s*(초|분|시간|일|주|개월|년)\s*전$/);
  if (!m) return null;
  const per = { 초: 0, 분: 0, 시간: 0, 일: 1, 주: 7, 개월: 30, 년: 365 }[m[2]];
  return shiftDays(Number(m[1]) * per);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── 1단계: 검색 ─────────────────────────────────────────────
// ytInitialData 안에서 videoRenderer 를 전부 긁는다. 검색 결과는 섹션 구조가
// 자주 바뀌므로 경로를 짚지 않고 트리 전체를 훑는다
function collectRenderers(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (node.videoRenderer) out.push(node.videoRenderer);
  for (const k of Object.keys(node)) collectRenderers(node[k], out);
  return out;
}

const runsText = (o) => (o?.runs || []).map((r) => r.text).join('') || o?.simpleText || '';

async function search(query) {
  const html = await fetchText(`${SEARCH_URL}?search_query=${encodeURIComponent(query)}`);
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error('ytInitialData 파싱 실패');
  const renderers = collectRenderers(JSON.parse(m[1]), []);
  const out = [];
  for (const v of renderers) {
    if (!v.videoId) continue;
    const owner = v.ownerText?.runs?.[0];
    out.push({
      videoId: v.videoId,
      title: runsText(v.title),
      description: runsText(v.detailedMetadataSnippets?.[0]?.snippetText).slice(0, 300),
      channel: owner?.text || '',
      channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId || '',
      // 썸네일은 videoId 로 항상 만들 수 있어 별도 저장이 필요 없다
      duration: v.lengthText?.simpleText || '',
      date: parseRelativeDate(v.publishedTimeText?.simpleText),
    });
  }
  log(`'${query}' → ${out.length}건`);
  return out;
}

// ── 2단계: 상세 (정확한 업로드일 + 조회수) ────────────────────
async function fetchDetail(videoId) {
  const html = await fetchText(`${WATCH_URL}?v=${videoId}`);
  const uploadDate = (html.match(/"uploadDate":"(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const viewCount = (html.match(/"viewCount":"(\d+)"/) || [])[1];
  if (!uploadDate && viewCount == null) throw new Error('상세 파싱 실패');
  return { date: uploadDate, views: viewCount != null ? Number(viewCount) : null };
}

// 신규 영상을 먼저 본다 — 상한에 걸려도 새 영상의 날짜는 확보된다.
// 조회수는 계속 변하므로 기존 영상도 남는 예산만큼 갱신한다
async function attachDetails(videos, runIso) {
  const fresh = videos.filter((v) => !v.detailCheckedAt);
  const stale = videos
    .filter((v) => v.detailCheckedAt)
    .sort((a, b) => String(a.detailCheckedAt).localeCompare(String(b.detailCheckedAt)));
  const batch = [...fresh, ...stale].slice(0, DETAIL_PER_RUN);
  if (!batch.length) return;
  if (fresh.length > batch.length) {
    log(`상세 조회 ${batch.length}건만 진행 — 남은 신규 ${fresh.length - batch.length}건은 다음 실행에서`);
  }
  let ok = 0;
  for (const v of batch) {
    try {
      const d = await fetchDetail(v.videoId);
      if (d.date) v.date = d.date;
      if (d.views != null) v.views = d.views;
      v.detailCheckedAt = runIso;
      ok++;
    } catch (e) {
      // 실패해도 검색 결과의 근사 날짜는 남아 있다. 다음 실행에서 다시 시도한다
      log(`상세 실패: ${v.title.slice(0, 30)} — ${e.message}`);
    }
    await sleep(350);
  }
  log(`상세 ${ok}/${batch.length}건 갱신 (신규 ${fresh.length}건)`);
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(OUT_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { videos: [] }; throw e; }
}

function dedupe(prev, fresh, runIso) {
  const byId = new Map(prev.map((v) => [v.videoId, v]));
  let added = 0;
  for (const v of fresh) {
    const hit = byId.get(v.videoId);
    if (!hit) {
      byId.set(v.videoId, { ...v, firstSeenAt: runIso });
      added++;
      continue;
    }
    // 제목·채널은 바뀔 수 있으니 최신값으로. 날짜는 상세에서 확정한 값을 지킨다
    hit.title = v.title || hit.title;
    hit.channel = v.channel || hit.channel;
    if (!hit.description && v.description) hit.description = v.description;
    if (!hit.date && v.date) hit.date = v.date;
  }
  return { merged: [...byId.values()], added };
}

async function main() {
  const fresh = [];
  for (const q of QUERIES) {
    try {
      fresh.push(...(await search(q)));
    } catch (e) {
      log(`'${q}' 실패: ${e.message}`);
    }
    await sleep(600);
  }

  if (!fresh.length) {
    log('수집된 영상 없음 — 기존 파일 유지');
    return;
  }

  const relevant = fresh.filter(isRelevant);
  log(`관련 영상 ${relevant.length}건 / 검색 결과 ${fresh.length}건 (무관 ${fresh.length - relevant.length}건 제외)`);

  const existing = await loadExisting();
  const runIso = new Date().toISOString();
  const { merged, added } = dedupe(existing.videos || [], relevant, runIso);

  // 관련성 판정은 매번 다시 돌린다 — 규칙을 고치면 기존 누적분도 함께 정리된다
  const videos = merged
    .filter(isRelevant)
    .map((v) => ({ ...v, official: OFFICIAL_CHANNEL_IDS.includes(v.channelId) }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  await attachDetails(videos, runIso);
  videos.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const officialCount = videos.filter((v) => v.official).length;
  const out = {
    lastScrapedAt: runIso,
    queries: QUERIES,
    totalVideos: videos.length,
    officialVideos: officialCount,
    externalVideos: videos.length - officialCount,
    channelCount: new Set(videos.map((v) => v.channelId)).size,
    totalViews: videos.reduce((s, v) => s + (v.views || 0), 0),
    videos,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  log(`저장 완료: 누적 ${videos.length}건 (신규 +${added}건 · 공식 ${officialCount} / 외부 ${videos.length - officialCount}) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('유튜브 수집 오류:', err.message);
  process.exit(0); // 비차단
});
