# 공평셈 — 먹은 만큼 나누는 정산

술 안 마신 사람, 2차에 빠진 사람까지 반영해 나누고, 결과를 링크 하나로 보내는 웹 정산 계산기.
서버·DB 없이 정적 파일만으로 동작해요. 정산 내역은 공유 링크의 `#` 뒤에 압축되어 담겨요.

## 구조

```
index.html          진입점 (GTM 스니펫 자리 포함)
styles.css          디자인 (소주병 초록 + 영수증)
js/calc.js          차등 정산 계산 (순수 함수)
js/share.js         정산 내역 ↔ 공유 링크 변환
js/track.js         이벤트 추적 레이어 (dataLayer)
js/app.js           화면과 상호작용
vendor/lz-string.min.js  URL 압축 라이브러리
tests/calc.test.mjs 계산·공유 테스트 (PRD P0 산출물)
```

## 로컬 실행 · 테스트

```bash
npx serve .            # 또는 python3 -m http.server
npm install && npm test
```

## GitHub에 올리기 (명령어 없이 웹에서)

1. github.com에서 가입·로그인 후 오른쪽 위 **+** → **New repository**.
2. Repository name에 `gongpyeongsem` 입력, **Add a README file은 체크하지 않음** → **Create repository**.
3. 만들어진 페이지에서 **uploading an existing file** 링크 클릭.
4. 컴퓨터의 `gongpyeongsem` 폴더를 열고, **폴더 자체가 아니라 안의 파일·폴더 전부**(index.html, styles.css, js, vendor, tests 등)를 선택해 업로드 영역으로 끌어다 놓기.
5. 아래 **Commit changes** 클릭.
6. 저장소 첫 화면에 `index.html`이 바로 보이면 성공.

수정한 파일을 다시 올릴 때는 저장소 첫 화면 **Add file** → **Upload files**에 같은 이름의 파일을 끌어다 놓으면 덮어써져요. 하위 폴더 파일(예: `js/app.js`)은 `js` 폴더로 들어간 뒤 업로드해요.

## 배포 (Vercel)

1. vercel.com → **Continue with GitHub**로 가입·로그인.
2. **Add New** → **Project** → `gongpyeongsem` 저장소 **Import**.
3. Framework Preset은 **Other** 그대로, 다른 설정 없이 **Deploy**.
4. 완료되면 `https://<프로젝트명>.vercel.app` 주소가 생겨요. 이후 GitHub에 파일을 올릴 때마다 자동으로 다시 배포돼요.
5. 커스텀 도메인은 추후 Vercel 프로젝트의 **Settings → Domains**에서 연결해요.

## 정산 규칙

- 각 항목은 그 항목에 체크된 사람끼리 똑같이 나눠요.
- 결제한 사람을 제외한 사람은 자기 몫을 정산 단위(1·10·100원)로 버림한 금액을 보내요.
- 버림으로 생긴 끝전은 결제한 사람이 부담해요. 모든 사람 몫의 합은 항상 총액과 같아요.

## 이벤트 (window.dataLayer)

| 이벤트 | 시점 | 추가 파라미터 |
| --- | --- | --- |
| `landing_view` | 첫 화면 렌더 | `landing_type` (explain / instant) |
| `calc_start` | 랜딩 CTA 클릭, 또는 계산기 첫 입력 | `cta_position` (hero / calc / shared) |
| `member_add` | 참여자 2명 도달 시 1회 | `member_count` |
| `item_add` | 첫 항목 금액 입력 시 1회 | `item_count`, `has_exclusion` |
| `calc_complete` | 결과 화면 도달 | `member_count`, `item_count`, `has_exclusion`, `total_amount_range` |
| `share_link` | 공유·링크 복사 클릭 | `share_method` (web_share / copy), `share_id` |
| `shared_view` | 공유 링크로 열람 | `share_id`, `valid` |
| `shared_to_new_calc` | 수신자가 "나도 정산 만들기" 클릭 | `share_id` |

모든 이벤트 공통: `variant` (A/B), `entry_type` (direct / shared), `traffic_type` (internal / external), `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (세션 첫 유입 기준)

## 테스트용 URL 파라미터

| 파라미터 | 동작 |
| --- | --- |
| `?v=A` / `?v=B` | 랜딩 버전 강제 지정 (A 설명형, B 바로 입력) |
| `?internal=1` | 이 기기를 내부 트래픽으로 표시, `?internal=0`으로 해제 |
| `?debug=1` | 브라우저 콘솔에 이벤트 출력 |

## P2(측정 인프라) 할 일

- [ ] `index.html`의 GTM 스니펫 주석 해제 + `GTM-XXXXXXX` 교체
- [ ] GTM: 이벤트 8개를 GA4 이벤트 태그로 연결 (dataLayer 변수로 파라미터 전달)
- [ ] GA4 맞춤 측정기준 등록: `variant`, `entry_type`, `traffic_type`, `share_method`, `cta_position`, `landing_type`, `total_amount_range`, `share_id`
- [ ] GA4 내부 트래픽 필터: `traffic_type = internal` 기준, 테스트 모드로 검증 후 활성화
- [ ] Microsoft Clarity 설치
- [ ] 공유 미리보기용 `og:image` (1200×630) 추가
