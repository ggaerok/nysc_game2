# Solar System

Cosmos Ball 의 천체 그림·운영 방식을 가져온 새 게임입니다. 7×7 / 9×9 / 11×11 칸에 놓인 천체를
**태양 → 수성 → 금성 → 지구 → 화성 → 목성 → 토성 → 천왕성 → 해왕성** 순서대로 드래그해서 잇습니다.

- 최소 2개를 순서대로 이으면 사라지고, 위 천체가 내려와 채웁니다. 맨 윗줄은 선택할 수 없는 다음 천체 미리보기입니다.
- 점수는 복리: `10 × 2^(n-1) × n` (2개 40, 3개 120, 4개 320, 5개 800 … 9개 23,040). `src/game.js` 의 `pointsFor` 에서 바꿉니다.
- 제한 시간이 끝나면 게임이 끝나고 점수가 기록됩니다.
- 단체명, 운영 시작/종료, **제한 시간**은 관리 페이지(`/`)에서 설정합니다. 점수 기록·최고점·역대 기록은 Cosmos Ball 과 같습니다.
- 규칙 스위치(`src/game.js` 맨 위): `ALLOW_DIAGONAL`(대각선 허용), 기본 제한 시간.

배포·저장소 연결·관리 번호(ADMIN_KEY)는 Cosmos Ball 과 같은 방식입니다 (Vercel + Redis).
Redis 키는 `cosmos_order:` 로 시작하므로 Cosmos Ball 과 겹치지 않습니다.

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
