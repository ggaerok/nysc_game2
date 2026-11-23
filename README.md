# Solar System

Cosmos Ball 의 천체 그림·운영 방식을 가져온 새 게임입니다. 7×7 / 9×9 / 11×11 칸에 놓인 천체를
**태양 → 수성 → 금성 → 지구 → 화성 → 목성 → 토성 → 천왕성 → 해왕성** 순서대로 드래그해서 잇습니다.

- 최소 2개를 순서대로 이으면 사라지고, 위 천체가 내려와 채웁니다. 맨 윗줄은 선택할 수 없는 다음 천체 미리보기입니다.
- 점수는 복리: `10 × 2^(n-1) × n` (2개 40, 3개 120, 4개 320, 5개 800 … 9개 23,040). `src/game.js` 의 `pointsFor` 에서 바꿉니다.
- 제한 시간이 끝나면 게임이 끝나고 점수가 기록됩니다.
- 단체명, 운영 시작/종료, **제한 시간**은 관리 페이지(`/`)에서 설정합니다. 점수 기록·최고점·역대 기록은 Cosmos Ball 과 같습니다.
- 규칙 스위치(`src/game.js` 맨 위): `ALLOW_DIAGONAL`(대각선 허용), 기본 제한 시간.

배포는 Vercel, 저장소는 **Turso**(libSQL, 도쿄 `aws-ap-northeast-1`)입니다. 관리 번호는 `ADMIN_KEY` 환경변수입니다.
테이블 이름은 `solar_` 로 시작하므로(`TABLE_PREFIX` 로 바꿀 수 있음) Cosmos Ball(`cosmos_`)과 한 DB 를 같이 써도 겹치지 않습니다. 테이블은 처음 접속할 때 자동으로 만들어집니다.

### 환경변수 (Vercel > Settings > Environment Variables)
| 이름 | 설명 |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://<db이름>-<계정>.turso.io` |
| `TURSO_AUTH_TOKEN` | DB 접속 토큰 (Sensitive 로 저장) |
| `ADMIN_KEY` | 관리 페이지 번호 |

함수 실행 지역은 `vercel.json` 의 `regions: ["hnd1"]`(도쿄)로 DB 와 맞춰 둡니다.
`TURSO_DATABASE_URL` 이 없으면 서버는 '운영 종료'로 동작합니다(fail-closed).
접속자가 많아도 DB 가 버티도록 `/api/status`·`/api/hall` 의 GET 은 CDN 이 2초간 캐시하고, 숨겨진 탭은 상태 확인을 멈춥니다.

## 구조
```
public/index.html   관리 페이지 (단체명, 운영 시작/종료, 제한 시간, 역대기록)
public/play.html    참가자 입구
api/*.js, lib/*.js  운영 상태·점수·기록 (status 에 limit 추가)
src/sprites.js      Cosmos Ball 에서 가져온 태양~해왕성 그림 코드
src/game.js         게임 규칙·화면
src/game.template.html  화면(HTML/CSS)
tools/build.js      game/game.html 빌드 (npm run build:game)
```
로컬 실행: `npm install && npm run dev` → http://localhost:3000 (게임을 고쳤다면 `npm run build:game`)

## 서버 요청 규칙 (요청 수를 최소로)
- 상태 확인은 **접속하거나 새로고침할 때만** 한다. 자동 갱신 없음 (게임·첫 화면·관리 페이지 모두).
- 첫 확인이 실패하면 3초 간격으로 다시 시도하고, 연속 3번 실패하면 "연결할 수 없습니다"를 띄운다.
- 점수는 **게임이 끝날 때만** 보낸다: 게임 오버, 또는 진행 중 확인 창에서 "다시 시작"/"처음으로"를 눌렀을 때. 진행 중에는 보내지 않고, 게임 오버 중복 전송은 막는다.
- 점수 전송이 403(운영 중 아님)이면 바로 흰 화면으로 덮고, 새로고침 전까지 다시 확인하지 않는다.
- 관리 페이지는 "새로고침" 버튼, 그리고 시작·종료·기록 지우기 직후에만 서버를 다시 확인한다.
- 제한 시간 등 설정 변경은 참가자가 새로고침(또는 처음 접속)해야 반영된다.
