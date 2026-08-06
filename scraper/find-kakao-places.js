/**
 * 매장 이름으로 카카오맵 장소 ID(confirm_id) 자동 매칭
 *
 *  stores.json 의 매장명으로 카카오맵 모바일 검색을 호출 → 첫 결과의 data-cid 를
 *  stores-kakao.json 에 저장. 검색 API 키가 필요 없다(검색 결과 HTML 파싱).
 *
 *  매칭이 잘못되면 stores-kakao.json 을 직접 수정하세요.
 *  장소 ID 는 place.map.kakao.com/{id} 로 열어서 확인할 수 있습니다.
 */
const fs = require('fs').promises;
const path = require('path');

const SRC = path.join(__dirname, 'stores.json');
const OUT = path.join(__dirname, 'stores-kakao.json');
const SEARCH_URL = 'https://m.map.kakao.com/actions/searchView';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const log = (...a) => console.log(`[find-kakao ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPlace(name) {
  const res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(name)}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`검색 HTTP ${res.status}`);
  const html = await res.text();
  // 검색 결과 <li> 의 data-cid 가 장소 ID, data-title 이 장소명
  const id = (html.match(/data-cid="(\d+)"/) || [])[1] || null;
  const title = (html.match(/data-title="([^"]+)"/) || [])[1] || null;
  return id ? { id, title } : null;
}

async function main() {
  const stores = JSON.parse(await fs.readFile(SRC, 'utf8'));
  log(`총 ${stores.length}개 매장 검색 시작`);
  const result = [];
  for (const s of stores) {
    try {
      const place = await findPlace(s.name);
      if (place) {
        log(`✓ ${s.name} → ${place.id} (${place.title})`);
        result.push({ id: s.id, name: s.name, kakaoPlaceId: place.id, kakaoDisplayName: place.title });
      } else {
        log(`✗ ${s.name} → 검색 결과 없음`);
        result.push({ id: s.id, name: s.name, kakaoPlaceId: null });
      }
    } catch (e) {
      log(`✗ ${s.name} → 실패: ${e.message}`);
      result.push({ id: s.id, name: s.name, kakaoPlaceId: null });
    }
    await sleep(500);
  }
  await fs.writeFile(OUT, JSON.stringify(result, null, 2), 'utf8');
  const matched = result.filter((r) => r.kakaoPlaceId).length;
  log(`저장: ${OUT} (매칭 ${matched}/${result.length})`);
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
