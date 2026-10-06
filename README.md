# 한 달 성경 읽기

읽고 싶은 성경 범위(장)를 고르면, 그 달 1일부터 말일까지 날마다 비슷한 분량으로 나누어 주는 PWA입니다.
본문은 새번역이며, 날마다 읽었는지는 브라우저 안의 SQLite 데이터베이스에 기록합니다.

## 시작하기

Node.js 20 이상이 필요합니다.

```sh
npm install      # sql.js를 받아 app/vendor/로 복사
npm start        # http://localhost:5173
```

새번역 본문 데이터(`app/data/`)는 저장소에 들어 있습니다. 다시 만들려면 `npm run crawl`을 실행합니다(약 10분).
내려받은 HTML은 `.cache/saenew/`에 남으므로, 다시 실행해도 사이트에 요청하지 않고 JSON만 다시 만듭니다.
(`--build`: 캐시로 JSON만 생성, `--no-build`: 내려받기만)

```sh
npm test         # 분배 알고리즘·파서 테스트
npm run icons    # 앱 아이콘 다시 그리기
```

## 휴대폰에 설치하기

서비스 워커(오프라인, 홈 화면 설치)는 `localhost`나 HTTPS에서만 동작합니다.
`app/` 폴더가 그대로 배포할 정적 사이트이므로 GitHub Pages, Netlify, Cloudflare Pages 같은 HTTPS 정적 호스팅에 올린 뒤
휴대폰 브라우저에서 "홈 화면에 추가"를 하면 됩니다.

## 분량을 나누는 방법

- 고른 장을 성경 순서대로 이어 붙이고, 공백을 뺀 글자 수를 읽는 분량으로 봅니다.
- 이를 그 달의 날 수만큼 연속된 묶음으로 나누되, 각 날 분량이 평균에서 벗어난 정도(제곱합)가 가장 작은 분할을
  동적 계획법으로 찾습니다 (`app/js/planner.js`).
- 끊는 위치에 따라 벌점을 주어, 분량 차이가 크지 않으면 **책 경계 > 장 경계 > 단락 제목 > 아무 절** 순서로 자연스러운 곳에서 끊습니다.
  그래서 장이 넉넉하면 장 단위로 나뉘고, 고른 장이 날 수보다 적거나 시편 119편처럼 긴 장이 있으면 그 장을 절 단위로 나눕니다.
  새 계획 화면에서 "장 중간에서도 나누기"를 끄면 장을 절대 쪼개지 않습니다.
- 예) 신약 260장 → 하루 23–29분, 성경 전체 → 하루 평균 약 110분 (1분에 500자 기준)

## 기록 저장

- [sql.js](https://sql.js.org)(WebAssembly SQLite)로 브라우저 안에서 SQLite를 돌리고, 데이터베이스 파일을 IndexedDB에 보관합니다.
  서버가 없으므로 기록은 기기(브라우저)마다 따로 저장됩니다.
- 설정 화면에서 `.sqlite` 파일로 내보내거나 가져올 수 있습니다. 내보낸 파일은 일반 SQLite 도구로 열 수 있습니다.

| 테이블 | 내용 |
| --- | --- |
| `plans` | 달마다 하나의 계획 (선택한 장, 계획 이름) |
| `plan_days` | 날짜별로 읽을 범위(JSON)와 글자 수 |
| `readings` | 읽음 표시한 날과 시각 |
| `settings` | 글자 크기, 글꼴 |

## 폴더 구조

```
app/                  배포할 정적 사이트 (PWA)
  index.html, sw.js, manifest.webmanifest
  js/planner.js       분량 나누기 (DOM 없는 순수 모듈)
  js/db.js            SQLite 스키마와 질의
  js/bible.js         본문 불러오기, 구절 표기
  js/views/           화면 (오늘, 달력, 새 계획, 본문, 설정)
  data/               크롤링한 새번역 본문 (index.json + books/*.json)
scripts/
  crawl.mjs           새번역 크롤러, lib/parse.mjs 파서
  serve.mjs           개발용 정적 서버
test/                 node:test 테스트
```

## 저작권

새번역 본문의 저작권은 [대한성서공회](https://www.bskorea.or.kr)에 있습니다. 개인 묵상 용도로만 사용하세요.
