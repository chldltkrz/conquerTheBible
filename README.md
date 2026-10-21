# 맛있는만나 (delicious manna)

읽고 싶은 성경 범위(장)를 고르면, 그 달 1일부터 말일까지 날마다 비슷한 분량으로 나누어 주는 PWA입니다.
기간은 기본이 한 달이고, "40일", "100일", "1년"처럼 시작일과 마지막 날을 직접 정할 수도 있습니다.
본문은 새번역이고 영어 BSB(Berean Standard Bible)로도 읽을 수 있으며, 날마다 읽었는지는 브라우저 안의 SQLite 데이터베이스에 기록합니다.

- **기간**: 새 계획 화면에서 "한 달"(기본)이나 "기간 직접 정하기"를 고릅니다. 기간은 최대 366일이고,
  한 계정 안에서는 기간이 겹치지 않습니다. 겹치는 계획이 있으면 확인을 받은 뒤 그 계획을 바꾸되,
  같은 날짜에 같은 범위를 읽은 기록은 새 계획으로 이어집니다(읽던 계획에 책을 더해도 원래 책의 진도가 남습니다).
  달력은 달 단위로 보여 주므로, 달을 넘는 계획은 걸친 달마다 그 달에 든 날만 보입니다.
- **읽는 방식** (새 계획 화면의 "어떻게 읽을까요?"):
  - **한 권씩 차례로**: 고른 책들을 성경 순서대로 이어 붙여 기간에 나눕니다.
  - **여러 권 동시에**: 책마다 따로 기간에 나누어 날마다 책마다 조금씩 함께 읽습니다. 책마다 따로 읽음 표시하고,
    진도도 "창세기 12/50장, 출애굽기 10/40장"처럼 책마다 따로 봅니다. 모든 책을 읽은 날을 그날 완료로 셉니다.
  - **그룹별로 동시에**: 책을 여러 그룹으로 묶어("시편" / "마태·마가·누가·요한" / "이사야·예레미야"), 그룹마다 따로
    기간에 나눕니다. 그룹 안에서는 한 권씩 차례로 읽고, 그룹끼리는 날마다 조금씩 함께 읽습니다.
    그룹마다 따로 읽음 표시하고 진도도 그룹별로 봅니다. 한 장은 한 그룹에만 들어갑니다.
- **구절 저장**: 본문을 읽다가 마음에 남는 절을 눌러 저장합니다. 다른 날 같은 절을 또 저장하면 횟수가 늘고,
  "구절" 탭에서 절마다 몇 번 저장했는지 볼 수 있습니다. (같은 날 안에서는 한 번으로 셉니다)
- **공유**: 본문에서 절을 골라 "공유"를 누르거나 구절 탭·검색·오늘의 말씀의 "공유"를 누르면 말씀 공유 창이 열립니다.
  - **말씀 카드**: 말씀을 배경 위에 얹은 이미지(1080px, 정사각형 또는 세로 9:16)를 만들어 카카오톡·인스타그램 등으로
    바로 보내거나(휴대폰의 공유 창) PNG로 저장합니다. 배경은 AI로 만든 풍경 그림 50장(주제 12가지)과 그러데이션 6가지 중에서
    고르고, 말씀의 낱말(목자·양 → 초장, 빛·등불 → 빛, 독수리·날개 → 하늘 …)로 어울리는 주제의 그림을 맨 앞에 권합니다.
    어울리는 주제가 없는 말씀은 모든 그림 중에서 말씀마다 다른 그림으로 시작합니다(같은 말씀은 늘 같은 그림).
    글꼴(명조·고딕)도 고를 수 있고, 모양·글꼴과 그러데이션을 고른 것은 기기마다 기억합니다.
    글자 크기는 말씀 길이에 맞춰 줄이고 줄 길이를 고르게 나누며, 아래에 `시편 23:1 · 새번역`과 앱 이름을 적습니다(`app/js/card.js`).
  - **글로 복사**: `말씀 - 책 장:절` 형식(예: `주님은 나의 목자시니, 내게 부족함 없어라. - 시편 23:1`)으로 클립보드에 복사합니다.
    여러 절은 `마태복음서 5:3-4, 9`처럼 범위로 적습니다.
- **밀린 분량 다시 나누기**: 며칠 못 읽었으면 오늘 화면의 "남은 기간에 다시 나누기"로 아직 안 읽은 분량을
  오늘부터 계획 끝까지 같은 알고리즘으로 다시 고르게 나눕니다. 읽은 날은 그대로 두고, 지난 날짜는
  "분량을 뒤로 옮김"으로 남습니다(연속 읽기는 그날에서 끊깁니다). 여러 권·그룹을 동시에 읽는 계획은 묶음마다 따로 나눕니다.
- **올해의 말씀**: 오늘 화면 맨 위 상자에 한 해 동안 마음에 품을 말씀을 정합니다. 오른쪽 연필 버튼으로 바꾸며,
  추천 구절이나 책·장·절로 본문을 불러오거나 교회 표어처럼 직접 적을 수 있습니다. 계정마다 따로 두고, 해가 바뀌면 다시 정합니다.
- **오늘의 통독 / 오늘의 말씀**: 읽기 계획이 있으면 오늘 읽을 분량(오늘의 통독)을, 계획이 없거나 쉬는 날이면
  날마다 바뀌는 오늘의 말씀(`app/js/verses.js`의 160여 구절)을 보여 줍니다. 오늘의 말씀도 공유·저장할 수 있습니다.
- **개발자에게 커피 보내기**: `app/js/views/settings.js`의 `COFFEE_LINKS`에 토스·카카오페이 등 송금 링크를 넣으면
  설정 화면에 버튼이 생깁니다. 링크가 없으면 배포한 사이트에서는 이 칸을 숨깁니다.
- **묵상 메모**: 본문 화면 아래에 그날의 묵상 메모를 남깁니다(입력하면 자동 저장). 저장한 구절에도 메모를
  달 수 있고, "구절" 탭의 "묵상 메모"에서 모두 모아 봅니다.
- **메모·구절 내보내기**: "묵상 메모"·"저장한 구절" 화면 위의 "내보내기"나 설정 > 기록 백업에서, 지금 계정의 묵상 메모(쓴 날 순서)와
  저장한 구절(성경 순서, 구절 메모 포함)을 글로 내보냅니다. 텍스트 파일로 저장하거나, 휴대폰 공유 창으로 다른 앱(카카오톡
  "나와의 채팅", 메모 앱 등)에 보내거나, 인쇄용 화면을 띄워 브라우저의 "PDF로 저장"으로 PDF를 만듭니다(`app/js/notesexport.js`).
- **어디까지 읽었는지**: 본문을 스크롤하면 화면 위에서 40% 높이(읽는 줄)를 지나간 절까지, 소리로 들으면 들은 절까지
  책(묶음)마다 기록합니다. 위로 돌아가 다시 읽어도 줄지 않습니다. 본문 머리말 아래 막대와 "· 60%"로 보이고,
  다시 열면 "지난번에 시편 37:30까지 읽었습니다 [이어 읽기]"로 그 절까지 내려갑니다. 오늘 화면에는 퍼센트와 막대,
  "이어 읽기" 버튼이 나옵니다. 퍼센트는 글자 수로 재며, 읽음 표시를 하기 전에는 99%를 넘지 않습니다.
  손으로 스크롤하기 전(처음 열 때, 오늘 화면에서 책을 눌러 바로 내려갈 때)은 세지 않습니다.
- **소리로 듣기**: 본문 화면의 스피커 버튼을 누르면 그날 분량을 한 절씩 읽어 주고, 읽는 절을 강조하며 따라 내려갑니다.
  잠시 멈춤·이전/다음 절·속도(0.8~1.5배)를 바꿀 수 있고, 절을 골라 "선택한 절부터 듣기"도 됩니다.
  브라우저에 들어 있는 음성 합성(Web Speech API)을 써서 외부 API 호출이나 비용이 없습니다. 설정에서 한국어 목소리를 고르며,
  기본은 기기 안에서 도는(인터넷이 필요 없는) 한국어 음성입니다.
- **말씀 검색**: "구절" 탭의 "검색"에서 새번역이나 BSB 전체를 낱말로 찾습니다. 여러 낱말을 띄어 쓰면 모두 들어 있는 절을
  찾고(BSB는 대소문자를 가리지 않음), 범위(전체·구약·신약·책)를 고를 수 있습니다. 결과에서 앞뒤 절 보기, 공유, 저장을 바로 할 수 있습니다.
- **역본**: 본문 화면 위나 설정의 "읽기 화면"에서 **새번역**, **BSB**(Berean Standard Bible, 현대 영어), **함께 보기**(새번역 절마다
  아래에 BSB)를 고릅니다. 기기마다 기억하며, 계획의 분량과 절 번호는 새번역을 따릅니다. 장의 절 수가 조금 다른 곳
  (고린도후서 13장은 BSB가 14절까지 등)은 구간이 그 장 마지막 절에서 끝나면 그 장 끝까지 보여 줍니다.
  BSB로 공유하면 `The LORD is my shepherd; I shall not want. - Psalm 23:1 (BSB)`처럼 영어 책 이름을 쓰고,
  소리로 듣기는 기기의 영어 음성으로 읽습니다. 오프라인 저장(설정)은 읽는 역본만 받습니다.
- **계정**: 계정마다 읽기 계획, 읽음 기록, 저장한 구절이 따로 있습니다. 한 기기에서 가족이 함께 쓰거나,
  한 사람이 "신약", "시편"처럼 여러 범위를 계정으로 나누어 번갈아 읽을 수 있습니다.
  오늘 화면에서 다른 계정의 오늘 분량과 읽음 여부를 보고 바로 바꿀 수 있습니다.
- **기기 간 동기화**: 로그인 없이 **동기화 코드** 하나로 휴대폰·태블릿·컴퓨터의 기록을 똑같이 맞춥니다.
  설정 > 기기 간 동기화에서 "동기화 시작하기"를 누르면 `ABCD-EFGH-JKLM` 같은 12자리 코드와 QR 코드가 나오고,
  다른 기기에서 "코드로 연결하기"에 코드를 넣거나 QR 코드(링크)로 열면 연결됩니다. 이 기기의 모든 계정
  (계획, 읽음 기록, 저장한 구절, 묵상 메모, 올해의 말씀)이 맞춰지고, 글자 크기·목소리·지금 계정은 기기마다 따로 둡니다.
  인터넷이 없을 때 바꾼 것은 다시 연결되면 보냅니다. 자세한 것은 아래 [기기 간 동기화](#기기-간-동기화).
- **읽기 알림**: 설정 > 읽기 알림에서 켜면, 매일 정한 시각(기본 오후 9시, 바꿀 수 있음)에 오늘 분량을 아직 다 읽지 않았을 때
  이 기기로 알림을 보냅니다. 알림에는 남은 분량("창세기 1–3장 · 약 12분")이 나오고, 누르면 앱이 열립니다.
  다 읽은 날과 읽을 분량이 없는 날(계획 없음, 쉬는 날)에는 보내지 않습니다. 켜고 끈 것과 시각은 기기마다 따로 둡니다.
  아이폰·아이패드는 홈 화면에 추가한 앱(iOS 16.4 이상)에서 켤 수 있습니다. 자세한 것은 아래 [읽기 알림](#읽기-알림).

사용자용 설명서(실제 화면 사진과 메뉴별 사용법, PDF 34쪽)는 [app/docs/user-manual.pdf](app/docs/user-manual.pdf)에 있고,
앱의 **설정 > 사용설명서**에서 바로 열 수 있습니다. 만드는 법은 아래 [사용설명서 만들기](#사용설명서-만들기).

## 시작하기

Node.js 20 이상이 필요합니다.

```sh
npm install      # sql.js 등을 받아 app/vendor/로 복사
npm start        # http://localhost:5173
```

기기 간 동기화까지 해 보려면 PostgreSQL과 동기화 서버가 필요합니다. `npm start`는 `/api/`로 오는 요청을
`SYNC_URL`(기본 `http://127.0.0.1:5690`)로 넘깁니다.

```sh
npm install --prefix server                                   # 서버 의존성(pg, web-push)
DATABASE_URL=postgres://사용자:암호@127.0.0.1:5432/DB이름 node server/sync-server.mjs
```

읽기 알림까지 보내려면 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`도 넘깁니다(만드는 법은 [읽기 알림](#읽기-알림)).
없으면 동기화만 하고 `/api/push/…`는 503을 돌려줍니다. 알림은 HTTPS(또는 localhost)에서만 켤 수 있습니다.

새번역 본문 데이터(`app/data/`)는 저장소에 들어 있습니다. 다시 만들려면 `npm run crawl`을 실행합니다(약 10분).
내려받은 HTML은 `.cache/saenew/`에 남으므로, 다시 실행해도 사이트에 요청하지 않고 JSON만 다시 만듭니다.
(`--build`: 캐시로 JSON만 생성, `--no-build`: 내려받기만)

BSB 본문(`app/data/bsb/books/`)도 저장소에 들어 있습니다. 다시 만들려면 `npm run bsb`를 실행합니다.
BSB를 펴내는 곳(bereanbible.com)의 USFM 묶음을 받아 `.cache/bsb/`에 두고, 단락 제목·시편 표제·각주를 새번역과 같은 형식의
JSON으로 바꿉니다(`scripts/lib/usfm.mjs`). 다시 받으려면 `--download`.

말씀 카드의 배경 그림(`app/img/cards/`)도 저장소에 들어 있습니다. 다시 만들려면 Vertex AI 익스프레스 모드 API 키와
그 프로젝트 번호를 주고 `npm run backgrounds`를 실행합니다(ImageMagick 필요). 이미지 AI(Nano Banana 2.1, `gemini-nano-banana-2.1`)로
주제마다 2K 세로 사진을 만들어 원본은 `.cache/backgrounds/`에 두고, 앱용 1080×1920 WebP와 작은 그림, 주제 목록(`index.json`)을 만듭니다.
그림에 글자·사람·종교 상징을 넣지 않게 하고 글자는 앱이 얹습니다. 주제·장면·낱말은 `scripts/backgrounds.mjs` 맨 위에 있습니다.

```sh
GEMINI_API_KEY=… GOOGLE_CLOUD_PROJECT=… npm run backgrounds    # 없는 것만 만든다 (--redo 주제-번호: 그것만 다시, --build: 원본으로 앱용 파일만)
```

```sh
npm test         # 분배 알고리즘·파서·동기화 테스트
npm run icons    # 앱 아이콘, 링크 미리보기 그림(og-image.png), favicon.ico 다시 그리기
```

동기화·읽기 알림 테스트 중 서버와 주고받는 것은 `TEST_DATABASE_URL`(운영과 다른 PostgreSQL DB, 테스트마다 비운다)이
있어야 돌고, 없으면 건너뜁니다. 이 서버에서는 `/etc/conquer-the-bible/sync.env`에 들어 있습니다.
두 테스트가 같은 DB를 비우므로 테스트 파일은 하나씩 차례로 돌립니다(`--test-concurrency=1`).

```sh
set -a; . /etc/conquer-the-bible/sync.env; set +a; npm test
```

## 휴대폰에 설치하기

서비스 워커(오프라인, 홈 화면 설치)는 `localhost`나 HTTPS에서만 동작합니다.
`app/` 폴더가 그대로 배포할 정적 사이트이므로 GitHub Pages, Netlify, Cloudflare Pages 같은 HTTPS 정적 호스팅에 올린 뒤
휴대폰 브라우저에서 "홈 화면에 추가"를 하면 됩니다. 다만 기기 간 동기화는 같은 주소의 `/api/`에 동기화 서버가 있어야 합니다(아래 [배포](#배포)).

## 분량을 나누는 방법

- 고른 장을 성경 순서대로 이어 붙이고, 공백을 뺀 글자 수를 읽는 분량으로 봅니다.
- 이를 계획 기간의 날 수만큼 연속된 묶음으로 나누되, 각 날 분량이 평균에서 벗어난 정도(제곱합)가 가장 작은 분할을
  동적 계획법으로 찾습니다 (`app/js/planner.js`).
- 끊는 위치에 따라 벌점을 주어, 분량 차이가 크지 않으면 **책 경계 > 장 경계 > 단락 제목 > 아무 절** 순서로 자연스러운 곳에서 끊습니다.
  그래서 장이 넉넉하면 장 단위로 나뉘고, 고른 장이 날 수보다 적거나 시편 119편처럼 긴 장이 있으면 그 장을 절 단위로 나눕니다.
  새 계획 화면에서 "장 중간에서도 나누기"를 끄면 장을 절대 쪼개지 않습니다.
- 예) 신약 260장 → 하루 23–29분, 성경 전체 → 하루 평균 약 110분 (1분에 500자 기준)

## 기록 저장

- [sql.js](https://sql.js.org)(WebAssembly SQLite)로 브라우저 안에서 SQLite를 돌리고, 데이터베이스 파일을 IndexedDB에 보관합니다.
  기록은 기기(브라우저)마다 저장되고, 기기 간 동기화를 켜면 바뀐 줄을 서버를 거쳐 다른 기기와 주고받습니다.
- 창마다 데이터베이스 사본을 메모리에 들고 파일 전체를 저장하므로, 같은 기기에서 여러 창(탭, 설치한 앱)을 열면
  한 번에 한 창만 씁니다(Web Locks). 새로 열거나 앞으로 나온 창이 쓰기를 넘겨받고, 넘긴 창은 "다른 창에서 쓰고 있습니다"를
  띄워 쉬다가 다시 앞으로 나오면 되찾습니다(그사이 바뀐 기록은 다시 읽습니다).
- 입력을 멈추면 저장하는 묵상 메모는 앱을 떠나거나(화면이 가려지거나) 다른 창에 넘길 때 바로 저장합니다.
- 설정 화면에서 `.sqlite` 파일로 내보내거나 가져올 수 있습니다. 내보낸 파일은 일반 SQLite 도구로 열 수 있습니다.
  내보낸 파일에는 동기화 코드가 들어가지 않습니다. 동기화 중에 백업을 가져오거나 모든 기록을 지우면 동기화된 다른 기기도 그렇게 바뀝니다.

| 테이블 | 내용 |
| --- | --- |
| `accounts` | 계정 (이름, 색) |
| `plans` | 계정마다 기간(시작일·마지막 날)마다 하나의 계획 (선택한 장, 계획 이름, 읽는 방식). 한 계정 안에서 기간은 겹치지 않는다 |
| `plan_tracks` | 계획 안의 묶음. 한 권씩 차례로(`sequential`)는 하나, 여러 권 동시에(`parallel`)는 책마다 하나, 그룹별로 동시에(`group`)는 그룹마다 하나 |
| `plan_days` | 묶음별로 시작일부터 몇 번째 날(`day`)에 읽을 범위(JSON)와 글자 수. `moved`는 다시 나누기로 분량을 뒤로 옮긴 날 |
| `readings` | 묶음별로 읽음 표시한 날(`day`)과 시각 |
| `reading_progress` | 묶음별로 그날 분량을 어디까지 읽었는지(마지막 절). 다시 나누기로 그날 분량이 바뀌면 지운다 |
| `saved_verses` | 저장한 절 (저장한 날마다 한 줄, 저장 당시 본문 포함). 계획을 지워도 남는다 |
| `day_notes` | 날짜별 묵상 메모 (그날 읽은 범위 포함). 계획을 다시 만들어도 남는다 |
| `verse_notes` | 저장한 구절에 단 메모 (절마다 하나) |
| `settings` | 글자 크기, 글꼴, 역본, 지금 계정 (기기 공통), 계정마다의 올해의 말씀(`yearVerse:계정번호`) |
| `sync_state` | 기기 간 동기화 상태: 동기화 코드, 받은 마지막 번호(cursor) 등. 동기화하지 않으면 비어 있다 |
| `sync_outbox` | 동기화하는 동안 바뀌어 아직 보내지 않은 줄의 표 이름과 기본 키 (트리거가 적는다) |

스키마 버전은 `PRAGMA user_version`으로 관리하며, 이전 버전 데이터베이스나 백업 파일은 열 때 자동으로 옮겨집니다.
계정·계획·저장한 구절의 번호는 기기마다 따로 만들어도 겹치지 않도록 무작위(2^32 이상 2^53 미만)로 정합니다.
예전 자동 번호(1, 2, …)는 그 기기 기록으로 동기화를 시작할 때 무작위 번호로 바꿉니다.

## 사용설명서 만들기

설명서 글은 `docs/manual/manual.html`(꾸밈은 `manual.css`)에 있고, `npm run manual`이 화면 사진을 새로 찍어 PDF로 만듭니다.

```sh
npx playwright install chromium      # 처음 한 번 (헤드리스 크롬)
npm run manual                       # 화면 52장을 찍고 app/docs/user-manual.pdf를 만든다 (몇 분)
npm run manual -- --only card,export # 그 화면만 다시 찍고 PDF
npm run manual -- --pdf              # 글만 고쳤으면 찍어 둔 화면으로 PDF만
```

- **예시 기록** (`scripts/lib/manual-demo.mjs`): 앱의 `db.js`로 계정 셋(나·엄마·하은), 계획 셋(한 권씩·여러 권 동시에·그룹별), 읽음 기록,
  저장한 구절, 묵상 메모, 올해의 말씀을 만들어 앱의 "가져오기"와 같은 방식으로 넣습니다. 오늘은 2026년 10월 17일로 정해 두고 브라우저의 시각도
  그날로 고정하므로, 다시 만들어도 같은 화면이 나옵니다.
- **화면 찍기** (`scripts/manual.mjs`, `scripts/lib/manual-env.mjs`): app/를 임시 서버로 띄우고(운영 동기화 서버에 닿지 않도록 `/api/`는 가짜로
  답한다), 휴대폰 크기(390×844)의 크롬으로 화면마다 정해 둔 동작을 한 뒤 설명할 곳에 빨간 테두리와 번호를 얹어 찍습니다. 사진은
  `.cache/manual/shots/`에 둡니다. 헤드리스 크롬에 없는 휴대폰 공유 창·알림 허용·한국어 음성은 흉내 냅니다.
- 화면 사진의 번호 순서(`SHOT_LIST`의 `marks`)와 글의 번호 목록(`ol.marks`) 순서가 짝이 맞아야 합니다. 새 화면을 넣으려면 `SHOT_LIST`에
  하나 더하고 글에 `<img src="shots/이름.jpg">`를 넣습니다. 찾지 못한 곳이 있으면 그 화면을 `*.failed.jpg`로 남기고 멈춥니다.

## 기기 간 동기화

로그인 대신 **동기화 코드**가 열쇠입니다. 코드를 아는 기기는 모두 같은 기록을 보고 고칩니다.

- **코드**: 서버가 만들어 처음 한 번만 알려 줍니다. 헷갈리는 글자(0·O, 1·I)를 뺀 32글자로 12자리(60비트)이고,
  서버에는 SHA-256 해시만 저장합니다. 링크(`https://…/#sync=코드`)는 코드를 `#` 뒤에 두어 서버로 가지 않고,
  앱을 열면 주소에서 바로 지워 사용 통계에도 남지 않습니다.
- **연결할 때**: 새 기기처럼 기록이 없으면 동기화된 기록을 받습니다. 양쪽에 기록이 있으면 어느 쪽을 남길지 묻습니다
  ("동기화된 기록 받기" 또는 "이 기기 기록 남기기" — 고르지 않은 쪽은 지워집니다).
- **주고받는 단위**: SQLite 줄입니다. 동기화하는 동안 트리거가 바뀐 줄의 기본 키를 `sync_outbox`에 적고,
  보낼 때 그 줄의 지금 값(지웠으면 `null`)을 보냅니다. 서버는 줄마다 마지막 값과, 동기화 공간 안에서 1씩 커지는
  번호를 둡니다. 기기는 받은 마지막 번호 다음부터 받아 트리거를 끈 채 덮어씁니다.
- **언제**: 앱을 열 때, 기록을 바꾸고 1.5초 뒤, 앱으로 돌아오거나 떠날 때, 인터넷이 다시 될 때, 켜 둔 동안 1분마다.
  받은 기록은 지금 화면에 바로 반영하되, 메모를 쓰는 중이거나 창이 열려 있거나 소리로 듣는 중이면 끝난 뒤에 다시 그립니다.
- **어긋날 때**: 같은 줄을 두 기기가 고치면 서버에 나중에 도착한 쪽이 이깁니다. 아직 보내지 않은 이 기기의 변경은
  받은 값보다 앞섭니다. 같은 날 같은 구절을 두 기기에서 저장하면 하나만 남기고, 같은 계정에 기간이 겹치는 계획을
  두 기기에서 따로 만들면 나중에 만든 계획을 남기며 같은 날짜·범위의 읽음 기록은 그 계획으로 옮깁니다.
  지워진 계획에 읽음 표시한 것처럼 부모가 없는 줄은 버립니다.
- **새로 더한 표**: 예전 서버는 모르는 표가 든 요청을 통째로 거절하므로, 뒤에 더한 표(`reading_progress`)는
  서버 응답의 `tables`에 그 표가 있을 때만 보냅니다(`SYNC_TABLES`의 `optional`). 앱만 먼저 배포해도 동기화는 멈추지 않고,
  서버를 새로 배포한 뒤부터 그 표도 맞춰집니다. 표를 더할 때는 서버의 `TABLES`에도 더합니다.
- **끄기**: "이 기기만 끄기"는 이 기기의 동기화만 멈춥니다. "모든 기기에서 끄기"는 서버 기록을 지우고,
  다른 기기들도 다음 동기화에서 멈춥니다. 어느 쪽이든 기기에 있던 기록은 남습니다.

### 동기화 서버

`server/sync-server.mjs` (Node + [pg](https://node-postgres.com), PostgreSQL 15). 표 이름·키·값(JSON)만 다루고 내용은 해석하지 않습니다.
시작할 때 표를 만듭니다(`sync_spaces`: 코드 해시와 마지막 번호, `sync_rows`: 줄마다 마지막 값과 번호).

| 요청 | 내용 |
| --- | --- |
| `POST /api/sync/spaces` | 새 동기화 공간 → `{code}` |
| `GET /api/sync/space` | 공간 요약 (연결하기 전에 보여 줄 계정 이름, 표마다 줄 수) |
| `DELETE /api/sync/space` | 공간과 기록을 모두 지운다 ("모든 기기에서 끄기") |
| `POST /api/sync` | `{v: 1, cursor, replace?, changes: [{t, k, d}]}` → `{cursor, more, rows: [{t, k, d}]}`. 보낸 줄을 저장하고 cursor 다음부터 바뀐 줄을 돌려준다(한 번에 5천 줄까지, `more`면 이어서) |
| `GET /api/sync/health` | 서버·DB 확인 |

공간을 쓰는 요청은 `Authorization: Bearer <코드>` 헤더로 코드를 보냅니다. 요청 하나는 4MB, 공간 하나는 50만 줄(지운 줄 포함)까지입니다.

## 읽기 알림

웹 푸시(Push API + VAPID)로 보냅니다. 서버는 기록을 모르므로, **기기가 무엇을 언제 알릴지 계산해 올려 두고 서버는 시각에 맞춰 보내기만** 합니다.

- **기기** (`app/js/reminder.js`): 오늘부터 1년 동안 읽을 분량이 있는 날마다 `{text, done}`을 만듭니다. 이 기기의 모든 계정을 보고,
  분량이 있는 계정이 모두 읽었으면 `done`입니다. 남은 계정이 하나면 그 분량("창세기 1–3장 · 약 12분"), 여럿이면
  "계정 2개의 오늘 분량이 남아 있습니다"라고 적습니다(계정 이름은 보내지 않습니다). 이것을 알림 시각·시간대·푸시 구독과 함께
  `PUT /api/push/subscription`으로 올리고, 기록을 바꾸고 3초 뒤·앱을 열 때·떠날 때 바뀐 것이 있으면 다시 올립니다.
  동기화 중이면 동기화 코드를 함께 보내 같은 공간의 기기끼리 묶습니다.
- **서버** (`server/push.mjs`): 30초마다 알림 시각이 지난 구독을 꺼내 다음 날 같은 시각으로 옮기고, 그 시간대의 그날 줄이
  있고 `done`이 아니면 보냅니다. 같은 동기화 공간의 다른 기기가 그날 다 읽었다고 올렸으면 보내지 않습니다(휴대폰에서 읽었는데
  태블릿이 알리지 않도록). 서버가 멈췄다가 1시간 넘게 늦게 찾은 알림은 버리고, 기기가 꺼져 있으면 푸시 서비스가 3시간까지
  기다렸다 전합니다. 푸시 서비스가 구독이 없다고 하면(404·410: 브라우저에서 알림을 끄거나 앱을 지움) 지웁니다.
- **서비스 워커** (`app/sw.js`): 받은 푸시를 알림으로 띄우고, 누르면 열린 앱 창을 앞으로 가져오거나 새로 엽니다.
  브라우저가 구독을 바꾸면(`pushsubscriptionchange`) 서버의 구독도 바꿉니다.
- 서버는 푸시 서비스 주소(FCM, Mozilla, Apple, Windows)로만 보냅니다. 그 밖의 주소는 구독으로 받지 않습니다.

| 요청 | 내용 |
| --- | --- |
| `GET /api/push/key` | VAPID 공개 키 → `{key}` |
| `PUT /api/push/subscription` | `{subscription, time: "21:00", tz: "Asia/Seoul", days: {"2026-10-17": {text, done}}}`. 시각·시간대를 바꿨을 때만 다음 알림 시각을 다시 정한다 |
| `DELETE /api/push/subscription` | `{endpoint}` 구독을 지운다 |
| `POST /api/push/test` | `{endpoint}` 지금 시험 알림을 보낸다 (10초에 한 번) |
| `POST /api/push/renew` | `{old, subscription}` 바뀐 구독으로 옮긴다 (서비스 워커가 보낸다) |

VAPID 키는 한 번 만들어 `/etc/conquer-the-bible/sync.env`에 둡니다. 키를 바꾸면 이미 켠 기기는 앱을 다시 열 때 새로 구독합니다.

```sh
cd server && node -e "const k=require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey)"
```

## 사용 통계

- 어떤 기능을 얼마나 쓰는지 [PostHog](https://posthog.com)로 익명 이벤트를 보냅니다 (앱 열기, 화면 이동, 읽음 표시, 계획 만들기 등).
  PostHog는 `app/vendor/posthog.js`(no-external 빌드)로 함께 배포되며, 실행 중에 추가 스크립트를 받아오지 않습니다.
- 보내지 않는 것: 계정 이름, 계획 이름, 묵상 메모·구절 메모 내용, 절 본문, 검색어, 백업 파일 이름, 음성 이름, 동기화 코드.
  책 코드(`gen`, `psa` 등), 개수, 날짜 차이, 참/거짓, 기기 안에서 몇 번째 계정인지만 보냅니다.
- 설정 화면의 "익명 사용 통계 보내기"를 끄면 아무것도 보내지 않습니다.
- localhost, 사설 IP, `.test`·`.local` 같은 테스트 도메인(예: `ctb.test`)에서 열면 보내지 않고 브라우저 콘솔에 `[analytics]`로만 출력합니다 (콘솔 수준 "Verbose"에서 보임).
- PostHog 프로젝트 키와 서버 주소는 `app/js/analytics.js` 맨 위의 `POSTHOG_KEY`, `POSTHOG_HOST`에 있습니다.

## 폴더 구조

```
app/                  배포할 정적 사이트 (PWA)
  index.html, sw.js, manifest.webmanifest
  robots.txt, sitemap.xml, favicon.ico   검색 로봇용
  js/planner.js       분량 나누기 (DOM 없는 순수 모듈)
  js/db.js            SQLite 스키마와 질의, 동기화할 줄 모으기·받은 줄 넣기
  js/sync.js          기기 간 동기화: 서버와 주고받기, 언제 할지
  js/reminder.js      읽기 알림: 날마다 알릴 내용 계산, 푸시 구독
  js/bible.js         본문 불러오기, 구절 표기
  js/card.js          말씀 카드 그리기 (줄 나누기·글자 크기 맞추기, 공유 창은 views/cardsheet.js)
  js/notesexport.js   묵상 메모·저장한 구절 내보내기 (텍스트, 인쇄용 화면. 창은 views/exportsheet.js)
  js/views/           화면 (오늘, 달력, 구절, 새 계획, 본문, 설정)
  data/               크롤링한 새번역 본문 (index.json + books/*.json)
  data/bsb/books/     BSB 본문 (책마다 JSON, 형식은 새번역과 같다)
  img/cards/          말씀 카드 배경 그림 (1080×1920 WebP, thumb/ 작은 그림, index.json 주제 목록)
  docs/user-manual.pdf 사용설명서 (설정 화면에서 연다, npm run manual로 만든다)
server/
  sync-server.mjs     기기 간 동기화 서버 (PostgreSQL)
  push.mjs            읽기 알림: 구독 받기, 시각에 맞춰 웹 푸시 보내기
  http.mjs            두 서버가 함께 쓰는 HTTP 조각
  conquer-the-bible-sync.service  systemd 서비스
scripts/
  crawl.mjs           새번역 크롤러, lib/parse.mjs 파서
  bsb.mjs             BSB 받아서 JSON 만들기, lib/usfm.mjs 변환기
  backgrounds.mjs     말씀 카드 배경 그림 만들기 (이미지 AI)
  serve.mjs           개발용 정적 서버
  manual.mjs          사용설명서 PDF 만들기 (화면 찍기, lib/manual-demo.mjs 예시 기록, lib/manual-env.mjs 브라우저)
docs/manual/          사용설명서 글(manual.html)과 꾸밈(manual.css)
test/                 node:test 테스트
```

## 검색 노출(SEO)과 링크 미리보기

- `app/index.html`의 `<head>`에 제목·설명, 대표 주소(canonical), 링크 미리보기(Open Graph·X 카드),
  구조화 데이터(JSON-LD: `WebSite`, `WebApplication`)가 있습니다. 구조화 데이터의 `name`/`alternateName`으로
  검색 결과에 사이트 이름이 "맛있는만나"로 나오게 합니다.
- 앱이 뜨기 전 화면(`<main>` 안의 `.boot`)과 `<noscript>`에 앱 이름과 소개가 들어 있어,
  자바스크립트를 실행하지 않는 검색 로봇도 내용을 읽습니다.
- `app/robots.txt`는 `/api/`만 막고 `sitemap.xml`을 알려 줍니다. 화면을 그리는 데 필요한 `js/`, `data/`, `vendor/`는 막지 않습니다.
- 링크 미리보기 그림(`icons/og-image.png`, 1200×630)과 `favicon.ico`는 `npm run icons`로 만듭니다.
- 첫 화면이 빨리 뜨도록 `index.html`에서 sql.js wasm과 `data/index.json`을 `<link rel="preload">`로 미리 받고,
  nginx가 wasm도 gzip으로 압축해 보냅니다(658KB → 약 330KB).
- 서버의 공통 nginx 헤더(`/etc/nginx/header.conf`)에는 `X-Robots-Tag: noindex, nofollow`가 있어 그대로 두면
  검색에 전혀 나오지 않습니다. 이 사이트의 server 블록에서 보안 헤더를 다시 붙여 이를 덮어씁니다(아래 [배포](#배포)).
  배포한 뒤 `curl -sI https://delicious-manna.com/ | grep -i x-robots`가 아무것도 내놓지 않아야 합니다.
- 주소 `https://delicious-manna.com/`이 `index.html`(canonical, og:url, og:image, JSON-LD), `robots.txt`, `sitemap.xml`에
  적혀 있으므로 도메인을 바꾸면 함께 고칩니다.
- 검색 등록: [Google Search Console](https://search.google.com/search-console)과
  [네이버 서치어드바이저](https://searchadvisor.naver.com)에 사이트를 등록하고 `sitemap.xml`을 제출합니다.
  소유 확인용 메타 태그(`google-site-verification`, `naver-site-verification`)를 받으면 `index.html`의 `<head>`에 넣습니다.

## 배포

https://delicious-manna.com 은 nginx가 정적 파일(`/var/www/conquer-the-bible/html`)을 내보내고,
`/api/`는 동기화 서버(`127.0.0.1:5690`, systemd `conquer-the-bible-sync`)로 넘깁니다.
DB는 같은 서버의 PostgreSQL(`ctb_sync`)이고 접속 정보와 읽기 알림의 VAPID 키는 `/etc/conquer-the-bible/sync.env`(root만 읽음)에 있습니다.

```sh
# 앱
rsync -a --delete --chown=www-data:www-data app/ /var/www/conquer-the-bible/html/
# 동기화 서버
rsync -a --delete --exclude node_modules server/ /opt/conquer-the-bible/sync/
npm ci --omit=dev --prefix /opt/conquer-the-bible/sync
cp server/conquer-the-bible-sync.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable conquer-the-bible-sync && systemctl restart conquer-the-bible-sync
nginx -t && systemctl reload nginx
curl -s https://delicious-manna.com/api/sync/health   # {"ok":true}
```

nginx 설정(`/etc/nginx/conf.d/delicious-manna.com.conf`)에는 검색 로봇을 막지 않는 보안 헤더, wasm 압축,
`/api/`를 넘기는 곳과 요청 수 제한이 있어야 합니다.

```nginx
# server 블록 밖 (http 단계)
limit_req_zone $binary_remote_addr zone=ctb_sync:10m rate=60r/m;
limit_req_zone $binary_remote_addr zone=ctb_sync_new:10m rate=2r/m;

# delicious-manna.com server 블록 안
# header.conf의 X-Robots-Tag(noindex, nofollow)만 빼고 다시 붙인다. server에 add_header가 있으면 http 단계 것은 상속되지 않는다.
# location 안에서는 add_header를 쓰지 않는다(쓰면 이 헤더들이 빠진다). 캐시는 expires로 정한다.
add_header Strict-Transport-Security "max-age=15768000; includeSubDomains; preload;";
add_header X-Permitted-Cross-Domain-Policies none always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Frame-Options "SAMEORIGIN" always;

location /vendor/ {                    # 기본 gzip_types에 wasm이 없다
    gzip_types application/javascript application/wasm;
    expires epoch;
    try_files $uri =404;
}
location /api/ {
    limit_req zone=ctb_sync burst=40 nodelay;
    limit_req_status 429;
    client_max_body_size 4m;
    proxy_pass http://127.0.0.1:5690;
}
location = /api/sync/spaces {          # 새 코드 만들기는 더 적게
    limit_req zone=ctb_sync_new burst=5 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:5690;
}
```

## 저작권

새번역 본문의 저작권은 [대한성서공회](https://www.bskorea.or.kr)에 있습니다. 개인 묵상 용도로만 사용하세요.

BSB(The Holy Bible, Berean Standard Bible) 본문은 퍼블릭 도메인입니다(2023년 4월 30일부터). 출처: [bereanbible.com](https://bereanbible.com)
