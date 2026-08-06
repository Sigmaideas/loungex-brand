/**
 * Google Places API 로 매장 리뷰 수집
 *
 * - stores-google.json 의 googlePlaceId 기준
 * - Place Details API 는 호출당 최대 5건만, 그것도 '관련성순'으로 준다(공식 문서 명시).
 *   최신순 정렬 파라미터는 없고, 정렬을 지원하던 레거시 API 는 신규 프로젝트에서 막혀 있다.
 *   → languageCode 를 바꾸면 서로 다른 리뷰 세트가 오는 성질을 이용해 여러 언어로 훑는다.
 *     성수본점 기준 5건 → 17건으로 늘고, ko 만으로는 안 잡히던 최신 리뷰도 잡힌다.
 * - data/reviews-google.json 에 저장 ({ lastScrapedAt, reviews, errors, storeMeta })
 * - storeMeta: 매장별 구글 공식 평점/평가수 (리뷰 본문 제한과 무관한 전체 기준)
 *
 * 호출량: 매장 10 × 언어 4 × 일 1회 = 약 1,240/월 (언어 확장 전 310/월).
 */
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const STORES_PATH = path.join(__dirname, 'stores-google.json');
const REVIEWS_PATH = path.join(__dirname, '..', 'data', 'reviews-google.json');

// 언어별로 반환되는 리뷰 세트가 다르다. 실측 증분(성수본점 기준):
//   ko +5, en +5, ja +5, zh-CN +1, es/fr/vi/th/id +0
// → 증분이 있는 4개만 쓴다. 더 늘려봐야 호출 비용만 늘고 새 리뷰는 거의 없다.
const LANGUAGES = ['ko', 'en', 'ja', 'zh-CN'];

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const log = (...a) => console.log(`[scrape-google ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPlaceDetails(placeId, languageCode) {
  const url = `https://places.googleapis.com/v1/places/${placeId}?languageCode=${languageCode}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function mapReview(r, store) {
  // text 는 요청 언어로 '번역된' 본문이라 언어마다 달라진다 → 원문을 우선 저장해야
  // 같은 리뷰가 언어 수만큼 중복되지 않는다 (originalText 는 언어 무관하게 동일)
  const text = (r.originalText?.text || r.text?.text || '').trim();
  return {
    storeId: store.id,
    storeName: store.name,
    date: r.publishTime ? r.publishTime.slice(0, 10) : null,
    text,
    rating: r.rating != null ? Number(r.rating) || null : null,
    authorHash: r.authorAttribution?.displayName ? sha256(r.authorAttribution.displayName) : null,
    collectedAt: new Date().toISOString(),
  };
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(REVIEWS_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { lastScrapedAt: null, reviews: [], errors: [], storeMeta: {} }; throw e; }
}

// 본문 대신 저자+날짜로 식별한다. 저자명은 언어에 따라 바뀌지 않고, 기존 누적분도
// 같은 키를 만들 수 있어 언어 확장 전후 데이터가 섞이지 않는다.
const reviewKey = (r) => `${r.storeId}|${r.date}|${r.authorHash || r.text}`;

function dedupe(prev, fresh, runIso) {
  const seen = new Set(prev.map(reviewKey));
  const out = [...prev];
  let added = 0;
  for (const r of fresh) {
    const key = reviewKey(r);
    // 이번 수집에서 처음 등장한 리뷰만 firstSeenAt 기록 → 대시보드 NEW 배지 판별용
    if (!seen.has(key)) { seen.add(key); out.push({ ...r, firstSeenAt: runIso }); added++; }
  }
  return { merged: out, added };
}

async function main() {
  if (!API_KEY) throw new Error('GOOGLE_PLACES_API_KEY 환경변수가 필요합니다 (.env 파일 확인).');
  let allStores;
  try {
    allStores = JSON.parse(await fs.readFile(STORES_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('stores-google.json 이 없습니다. `npm run find:google` 먼저 실행하세요.');
    throw e;
  }
  const stores = allStores.filter((s) => s.googlePlaceId);
  if (stores.length === 0) {
    throw new Error('googlePlaceId 가 설정된 매장이 없습니다. `npm run find:google` 실행 또는 stores-google.json 수동 입력 필요.');
  }
  log(`총 ${stores.length}개 매장 수집 시작`);
  const existing = await loadExisting();
  const errors = [];
  const fresh = [];
  // 구글 공식 평점/평가수 — 리뷰 본문(최대 5건)과 달리 매장 전체 기준이라 대시보드 평점 컬럼에 사용
  const storeMeta = { ...(existing.storeMeta || {}) };
  for (const store of stores) {
    // 언어별 응답을 한 매장 단위로 합친 뒤, 같은 리뷰가 여러 언어에 걸쳐 나오는 경우를 먼저 정리한다
    const byKey = new Map();
    let meta = null;
    const langErrors = [];
    for (const lang of LANGUAGES) {
      try {
        const detail = await fetchPlaceDetails(store.googlePlaceId, lang);
        // 평점/평가수는 언어와 무관하므로 첫 성공 응답 것만 쓴다
        if (!meta) meta = { rating: detail.rating ?? null, ratingCount: detail.userRatingCount ?? null };
        for (const r of detail.reviews || []) {
          const mapped = mapReview(r, store);
          if (!mapped.text) continue;
          const key = reviewKey(mapped);
          if (!byKey.has(key)) byKey.set(key, mapped);
        }
      } catch (e) {
        langErrors.push(`${lang}: ${e.message}`);
      }
      await sleep(250);
    }
    if (meta) storeMeta[store.id] = meta;
    if (byKey.size === 0 && langErrors.length === LANGUAGES.length) {
      log(`실패 → ${store.name}: ${langErrors[0]}`);
      errors.push({ storeId: store.id, name: store.name, message: langErrors.join(' / '), at: new Date().toISOString() });
      continue;
    }
    const reviews = [...byKey.values()];
    const latest = reviews.map((r) => r.date).filter(Boolean).sort().pop() || '-';
    log(
      `수집 → ${store.name}: ${reviews.length}건 (전체 ${meta?.ratingCount ?? '?'}건 중, 최신 ${latest})` +
        (langErrors.length ? ` [일부 언어 실패: ${langErrors.length}]` : '')
    );
    fresh.push(...reviews);
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
