# 라운지엑스 매장 리뷰 모니터링 대시보드

라운지엑스(LOUNGE'X) 매장의 네이버 플레이스 리뷰를 주기적으로 수집하고, 매장별 리뷰 수·감성 분포·월간 활성도를 한눈에 볼 수 있는 **회사 내부용** 대시보드입니다.

---

## ⚠️ 법적 / 윤리적 주의사항

본 도구는 **회사 내부 운영 모니터링** 목적으로만 사용하며, 외부 공개·재배포·상용 데이터 판매를 금지합니다. 네이버는 약관(ToS)에서 자동화된 데이터 수집을 일반적으로 제한하며, 사용 시 다음 사항을 인지해야 합니다.

- **약관 리스크**: 네이버 ToS는 무단 크롤링을 제한할 수 있습니다. 본 프로젝트는 *공개적으로 노출된 매장 리뷰를 사람의 열람 패턴에 가까운 빈도(하루 2회 이하)로 수집*하지만, 차단·계정 제재의 가능성은 사용자가 감수해야 합니다.
- **저작권**: 리뷰 본문의 저작권은 작성자에게 있습니다. 수집된 데이터는 내부 분석에만 사용하고 외부에 재공개하지 마십시오.
- **개인정보**: 작성자 닉네임은 수집 즉시 SHA-256으로 해시 처리되어 원본이 저장되지 않습니다. 닉네임 외 개인정보는 수집하지 않습니다.
- **윤리적 운영**: 매장 간 2~5초·스크롤 간 1~3초 랜덤 딜레이, 하루 2회(오전·저녁) 실행을 기본값으로 합니다. 더 공격적인 빈도로 변경하지 마세요.

---

## 1. 설치

Node.js 18+ / Python 3 / macOS 또는 Linux 환경을 가정합니다.

```bash
npm install
npx playwright install chromium
cp .env.example .env
# .env 파일을 열어 ANTHROPIC_API_KEY 값을 채워 넣으세요
```

---

## 2. 매장 추가/수정

`scraper/stores.json`을 편집합니다.

```json
[
  {
    "id": "store_001",
    "name": "라운지엑스 강남점",
    "naverPlaceUrl": "https://map.naver.com/p/entry/place/12345678"
  }
]
```

- `id`: 매장 고유 식별자(자유 형식, 변경 시 기존 데이터와 매칭이 끊깁니다)
- `name`: 대시보드에 표시될 매장명
- `naverPlaceUrl`: 네이버 지도에서 해당 매장의 **상세 페이지 URL** (검색 URL이 아닌 `place/{ID}` 형태 권장)

URL을 얻는 방법: 네이버 지도에서 매장을 검색 → 상세 진입 → 주소창의 `https://map.naver.com/p/entry/place/{숫자ID}` 부분을 복사.

---

## 3. 사용법

```bash
# 1) 데이터 수집 + 감성분석 (한 번에)
npm run update

# 따로 실행도 가능
npm run scrape    # 리뷰 수집 → data/reviews.json
npm run analyze   # 감성분석 + 요약 → data/summary.json

# 그 외 수집원 (각각 독립 실행)
npm run update:google  # 구글 리뷰
npm run update:kakao   # 카카오맵 리뷰 (키 불필요)
npm run update:app     # 앱 리뷰 (구글플레이 + 앱스토어)
npm run rank           # 네이버 플레이스 검색 순위
npm run trend          # 브랜드 검색 관심도 (NAVER_CLIENT_ID/SECRET 필요)
npm run news           # 브랜드 뉴스 (구글 뉴스 RSS — 키 불필요)
npm run youtube        # 유튜브 언급 영상 (키 불필요)
npm run blog           # 네이버 블로그 언급 포스트 (키 불필요)

# 2) 대시보드 보기
npm run dashboard
# 브라우저에서 http://localhost:8080 접속
```

크롤링 진행 상황을 직접 보고 싶다면:

```bash
HEADLESS=false npm run scrape
```

---

## 4. 정기 실행 (macOS)

### 옵션 A: cron

```bash
crontab -e
```

매일 오전 7시에 실행:

```cron
0 7 * * * cd /Users/사용자/Documents/loungex-brand && /usr/local/bin/npm run update >> /tmp/loungex-scrape.log 2>&1
```

### 옵션 B: launchd (macOS 권장)

`~/Library/LaunchAgents/com.loungex.scrape.plist` 파일을 만들어 다음 내용 입력:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.loungex.scrape</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd /Users/사용자/Documents/loungex-brand && /usr/local/bin/npm run update</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/loungex-scrape.log</string>
  <key>StandardErrorPath</key><string>/tmp/loungex-scrape.err.log</string>
</dict>
</plist>
```

등록:

```bash
launchctl load ~/Library/LaunchAgents/com.loungex.scrape.plist
```

> ⚠️ 하루 **2회 이하** 실행을 권장합니다. 더 빈번한 실행은 차단 위험과 구글 API 비용을 함께 높입니다.

---

## 5. 폴더 구조

```
loungex-brand/
├── scraper/
│   ├── stores.json        # 모니터링 대상 매장 리스트 (네이버)
│   ├── stores-google.json # 매장 → 구글 place_id 매핑
│   ├── rank-config.json   # 매장별 순위 추적 좌표 + 검색어
│   ├── scrape.js          # Playwright 리뷰 크롤러
│   ├── scrape-google.js   # 구글 Places API 리뷰 수집
│   ├── stores-kakao.json  # 매장 → 카카오맵 장소 ID 매핑
│   ├── scrape-kakao.js    # 카카오맵(다음) 리뷰 수집
│   ├── scrape-app.js      # 구글플레이 + 앱스토어 앱 리뷰 수집
│   ├── scrape-rank.js     # 네이버 플레이스 검색 순위 수집
│   ├── scrape-trend.js    # 네이버 데이터랩 검색 트렌드
│   ├── scrape-news.js     # 브랜드 뉴스 수집 (구글 뉴스 RSS + 네이버 뉴스 API)
│   ├── scrape-youtube.js  # 유튜브 언급 영상 수집 (검색 결과 ytInitialData)
│   ├── scrape-blog.js     # 네이버 블로그 언급 포스트 수집 (통합검색 블로그탭)
│   └── analyze.js         # 감성분석 + 요약 생성
├── data/               # 자동 생성 (원시 리뷰는 git 무시)
│   ├── reviews.json    # 원시 리뷰 + 감성 라벨
│   ├── summary.json    # 대시보드 입력 데이터
│   ├── rank.json       # 검색 순위 + 일자별 추이
│   ├── trend.json      # 브랜드 검색 관심도
│   ├── news.json       # 브랜드 기사 누적 + 집계 (커밋됨)
│   ├── youtube.json    # 유튜브 언급 영상 누적 (커밋됨)
│   └── blog.json       # 네이버 블로그 언급 포스트 누적 (커밋됨)
├── index.html          # 대시보드 (GitHub Pages 루트)
├── style.css
├── app.js
├── logo.png
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 6. 트러블슈팅

### 리뷰가 0건으로 수집된다 / "리뷰 탭을 찾지 못했습니다" 에러

네이버는 페이지 구조와 클래스명을 자주 바꿉니다. `scraper/scrape.js` 상단의 `SELECTORS` 상수에 한 곳에 모아뒀으니 여기만 수정하세요.

```js
const SELECTORS = {
  entryIframe: 'iframe#entryIframe',
  reviewTab: 'a[role="tab"]:has-text("리뷰"), a:has-text("리뷰")',
  reviewItem: 'li.place_apply_pui, ...',
  reviewBody: 'a[class*="content"], ...',
  reviewDate: 'time, span[class*="date"], ...',
  // ...
};
```

**셀렉터 갱신 절차**:
1. `HEADLESS=false npm run scrape`로 실제 브라우저를 띄움
2. DevTools에서 리뷰 항목을 우클릭 → Inspect로 현재 클래스명 확인
3. `SELECTORS`의 해당 키를 새 셀렉터로 교체. 여러 후보가 있으면 콤마(`,`)로 구분해 OR 매칭하세요.

### 네이버에 차단된 것 같다

- **즉시 중단하고 24~48시간 휴식**. 추가 시도는 차단을 영구화시킬 수 있습니다.
- `headless: false`로 한 번 수동 방문하여 캡차/이상 페이지 여부 확인
- IP/네트워크를 잠시 변경 후 재시도. 재실행 시 `npm run scrape`보다 매장을 1~2개로 줄여 시작

### `summary.json`이 없어 대시보드가 비어 있다

`npm run update`를 한 번도 실행하지 않은 상태입니다. 먼저 `stores.json`에 실제 URL을 채우고 `npm run update`를 실행하세요.

### 뉴스 목록의 기사 사진이 안 나온다

썸네일은 원문 기사의 `og:image`입니다. 구글 뉴스 RSS 링크는 원문 주소를 감춘 리다이렉트라, `scraper/scrape-news.js`의 `resolveGoogleNewsUrl()`이 기사 페이지의 서명(`data-n-a-sg` / `data-n-a-ts`)을 뽑아 구글 내부 `batchexecute`로 원문 URL을 먼저 풀어냅니다. 구글이 이 구조를 바꾸면 "서명 파싱 실패" 로그와 함께 새 기사부터 사진이 비게 됩니다.

- 기사당 **한 번만** 조회하고 결과를 `imageCheckedAt`에 남깁니다. 실패한 기사를 다시 시도하려면 `data/news.json`에서 해당 기사의 `imageCheckedAt`(및 `image`)을 지우고 재실행하세요.
- 한 실행에서 최대 `IMAGE_LOOKUPS_PER_RUN`(기본 40)건만 훑습니다. 처음 도입 시에는 몇 번 나눠 실행해야 전부 채워집니다.
- 대시보드가 https로 서빙되므로 http 이미지는 저장하지 않습니다. 실제로 이미지가 내려오는지 확인된 URL만 기록되고, 사진이 없는 기사는 회색 자리 표시가 대신 들어갑니다.

### 유튜브 / 블로그 언급이 안 쌓인다

둘 다 API 키 없이 검색 결과 페이지를 직접 파싱하므로, 검색 화면이 개편되면 파싱이 먼저 깨집니다.

- **유튜브**: 검색 결과 HTML 안의 `var ytInitialData = {...}` 를 JSON 으로 읽고 `videoRenderer` 노드를 훑습니다. "ytInitialData 파싱 실패" 로그가 뜨면 이 변수명이 바뀐 것입니다. 정확한 업로드일·조회수는 영상 페이지의 `"uploadDate"` / `"viewCount"` 에서 따로 읽어옵니다(한 실행 최대 `DETAIL_PER_RUN`건).
- **블로그**: 통합검색 블로그탭을 `fetch` 로 받아 `data-template-id="ugcItem"` 기준으로 잘라 파싱합니다. 클래스명은 난독화돼 수시로 바뀌므로 절대 기준으로 쓰지 마세요. 썸네일은 항목 안 이미지 중 `blogfiles.naver.net` 이 들어간 첫 장을 씁니다(첫 이미지는 블로거 프로필 사진이라 건너뜁니다).

수집은 되는데 건수가 적다면 관련성 필터를 보세요. 각 스크립트 상단의 `BRAND_TOKENS`(브랜드 표기) · `ANCHORS`(카페·로봇 맥락) · `EXCLUDE`(동명 제외어)를 모두 통과해야 저장됩니다. 로그의 `관련 N건 / 검색 결과 M건` 이 판단 기준입니다.

블로그는 **최신순 4페이지(쿼리당 120건)** 까지만 훑으므로 과거 글은 한 번에 다 들어오지 않습니다. 실행이 쌓이면서 누적됩니다.

### 공식 채널 글이 외부 언급으로 잡힌다

자사 홍보글과 외부 입소문을 섞으면 지표가 왜곡되므로 따로 셉니다(블로그 화면의 전체/외부/공식 탭). 채널을 새로 만들었다면 목록에 추가하세요.

- 블로그: `scraper/scrape-blog.js` 의 `OFFICIAL_BLOG_IDS` (현재 `loungex_official`, `lounge_lab`, `xyz_inc`)
- 유튜브: `scraper/scrape-youtube.js` 의 `OFFICIAL_CHANNEL_IDS` (채널 ID는 `UC...` 형식)

유튜브 화면은 대신 전체/국내/해외로 나눕니다(공식 여부는 목록의 '공식' 배지로 남습니다). 블로그는 네이버라 사실상 전부 국내여서 이 구분을 두지 않습니다.

### 유튜브 영상이 국내/해외로 잘못 분류된다

유튜브 검색 결과에는 채널 국가 정보가 없어서, `scrape-youtube.js` 의 `regionOf()` 가 **제목·설명의 한글 비중**(`KR_RATIO_MIN`, 기본 0.3)으로 대신 판정합니다. 즉 '어느 나라 채널인가'가 아니라 '어느 나라 시청자를 향한 영상인가'가 기준입니다 — 한국 채널이 영어·일본어로 올린 영상은 해외로 잡힙니다.

- 채널명은 세지 않습니다. `King Food 킹푸드` 처럼 이름만 이중언어인 경우가 많아 기준으로 쓰면 어긋납니다.
- 공식 채널은 언어와 무관하게 국내입니다.
- 판정은 매 실행 다시 하므로, 기준을 고치면 이미 쌓인 영상에도 그대로 반영됩니다.

해외 영상 자체가 적다면 `INTL_QUERIES`(영어·일본어·중국어 검색어)를 늘리세요. 해외 검색어는 `hl=en&gl=US` 로 요청합니다 — 한국어 UI 로 요청하면 같은 영어 검색어라도 국내 영상이 위로 올라옵니다.

### Anthropic API 오류

- `.env`에 `ANTHROPIC_API_KEY`가 올바르게 설정되어 있는지 확인
- 모델 ID는 `scraper/analyze.js`의 `MODEL` 상수에서 변경 가능 (기본값: `claude-haiku-4-5-20251001`)
- 분석 실패한 리뷰는 자동으로 `neutral`로 표시되며, 다음 실행 시 재시도됩니다 (sentiment가 채워져 있으므로 스킵됨에 주의 — 강제 재분석을 원하면 해당 리뷰의 `sentiment` 필드를 삭제 후 재실행)

---

## 라이선스 / 책임 범위

본 코드는 라운지엑스 내부 모니터링 전용입니다. 외부 배포·제3자 제공은 금지하며, 사용 중 발생하는 약관/법적 이슈에 대한 책임은 운영자에게 있습니다.
