/**
 * 카카오맵(다음 검색) 매장 리뷰 수집
 *
 * - 카카오맵 장소 상세가 쓰는 panel3 API 를 그대로 호출한다.
 *   인증 키는 필요 없지만 `pf`/`appversion` 헤더가 없으면 406 이 떨어진다.
 * - 장소 ID(confirm_id)는 stores-kakao.json 에 저장. 없으면 `npm run find:kakao` 로 생성.
 * - 카카오는 별점만 남기고 글은 안 쓰는 이용자가 많다(평점 37건 중 본문 14건).
 *   그래서 본문 리뷰와 별개로 매장 평점/평가수를 storeMeta 에 따로 담는다.
 * - data/reviews-kakao.json 에 누적 저장 → SOURCE=kakao analyze.js 가 summary 생성
 *
 * 블로그 리뷰(blog_review)는 수집하지 않는다. 매장 이용 후기가 아니라 외부 블로그
 * 포스팅이라 감성 분석 대상이 아니고, 홍보성 글이 섞여 리뷰 통계를 왜곡한다.
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const STORES_PATH = path.join(__dirname, 'stores-kakao.json');
const REVIEWS_PATH = path.join(__dirname, '..', 'data', 'reviews-kakao.json');
const PANEL_URL = 'https://place-api.map.kakao.com/places/panel3';

// place-api 는 이 두 헤더가 없으면 406 을 돌려준다 (브라우저 요청과 동일하게 맞춤)
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  Referer: 'https://place.map.kakao.com/',
  Accept: 'application/json, text/plain, */*',
  pf: 'PC',
  appversion: '6.6.0',
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const log = (...a) => console.log(`[scrape-kakao ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPanel(placeId) {
  const res = await fetch(`${PANEL_URL}/${placeId}`, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`panel3 HTTP ${res.status}`);
  return res.json();
}

function mapReview(r, store) {
  const text = (r.contents || '').trim();
  return {
    storeId: store.id,
    storeName: store.name,
    // "2025-10-07 16:37:59" 형식 — 날짜만 쓴다
    date: r.registered_at ? r.registered_at.slice(0, 10) : null,
    text,
    rating: r.star_rating != null ? Number(r.star_rating) || null : null,
    authorHash: r.review_id != null ? sha256(String(r.review_id)) : null,
    collectedAt: new Date().toISOString(),
  };
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(REVIEWS_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { lastScrapedAt: null, reviews: [], errors: [], storeMeta: {} }; throw e; }
}

function dedupe(prev, fresh, runIso) {
  const seen = new Set(prev.map((r) => `${r.storeId}|${r.date}|${r.text}`));
  const out = [...prev];
  let added = 0;
  for (const r of fresh) {
    const key = `${r.storeId}|${r.date}|${r.text}`;
    if (!seen.has(key)) { seen.add(key); out.push({ ...r, firstSeenAt: runIso }); added++; }
  }
  return { merged: out, added };
}

async function main() {
  let allStores;
  try {
    allStores = JSON.parse(await fs.readFile(STORES_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('stores-kakao.json 이 없습니다. `npm run find:kakao` 먼저 실행하세요.');
    throw e;
  }
  const stores = allStores.filter((s) => s.kakaoPlaceId);
  if (stores.length === 0) throw new Error('kakaoPlaceId 가 설정된 매장이 없습니다. `npm run find:kakao` 실행 필요.');

  log(`총 ${stores.length}개 매장 수집 시작`);
  const existing = await loadExisting();
  const errors = [];
  const fresh = [];
  const storeMeta = { ...(existing.storeMeta || {}) };

  for (const store of stores) {
    try {
      const panel = await fetchPanel(store.kakaoPlaceId);
      const km = panel.kakaomap_review || {};
      const reviews = (km.reviews || []).map((r) => mapReview(r, store)).filter((r) => r.text);
      const score = km.score_set || {};
      storeMeta[store.id] = {
        rating: score.average_score ?? null,
        ratingCount: score.review_count ?? null,
      };
      log(
        `수집 → ${store.name}: 본문 ${reviews.length}건 (평점 ${score.average_score ?? '?'} · 평가 ${score.review_count ?? 0}건)`
      );
      fresh.push(...reviews);
    } catch (e) {
      log(`실패 → ${store.name}: ${e.message}`);
      errors.push({ storeId: store.id, name: store.name, message: e.message, at: new Date().toISOString() });
    }
    await sleep(500);
  }

  const runIso = new Date().toISOString();
  const { merged, added } = dedupe(existing.reviews || [], fresh, runIso);
  await fs.mkdir(path.dirname(REVIEWS_PATH), { recursive: true });
  await fs.writeFile(
    REVIEWS_PATH,
    JSON.stringify({ lastScrapedAt: runIso, reviews: merged, errors, storeMeta }, null, 2),
    'utf8'
  );
  log(`저장 완료: 누적 ${merged.length}건 (신규 +${added}건, 오류 ${errors.length}건)`);
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
