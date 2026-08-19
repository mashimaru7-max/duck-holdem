# DUCK HOLD'EM

Go-Go! Duck용 2~8인 실시간 텍사스 홀덤 MVP입니다. 클라이언트는 GitHub Pages에, 서버는 WebSocket을 지원하는 Node.js 호스팅에 각각 배포합니다.

## 구조

- `client`: React/Vite 반응형 게임 UI
- `server`: 서버 권한형 카드·턴·베팅·승패 판정 및 WebSocket 방 서버
- `shared`: 양쪽에서 공유하는 메시지·상태 타입

## 실행

```bash
npm install
npm run dev
```

- 클라이언트: http://localhost:5173
- 서버 상태: http://localhost:8787/health
- WebSocket: ws://localhost:8787/ws

## 배포

클라이언트 빌드 시 `VITE_WS_URL`을 운영 WebSocket 주소로 지정합니다.

```bash
VITE_WS_URL=wss://your-server.example/ws npm run build -w client
```

GitHub Pages 워크플로는 `.github/workflows/pages.yml`에 포함되어 있습니다. 서버는 Render, Fly.io, Railway, Cloud Run 등 WebSocket 지원 환경에 배포할 수 있습니다.

## Render 서버 배포

저장소 루트의 `render.yaml`과 `Dockerfile`은 Render Blueprint 배포용입니다.

1. [Render Blueprint 생성](https://dashboard.render.com/blueprints)에서 이 저장소를 연결합니다.
2. `duck-holdem-server` 무료 서비스를 생성합니다.
3. 배포가 끝나면 서버 주소를 `wss://<서비스주소>/ws` 형태로 확인합니다.
4. GitHub 저장소 `Settings → Secrets and variables → Actions → Variables`에 `VITE_WS_URL`로 등록합니다.
5. GitHub Pages 워크플로를 다시 실행합니다.

무료 인스턴스는 유휴 후 절전될 수 있어 첫 접속에 시간이 걸릴 수 있습니다. 운영 버전에서는 유료 상시 실행 또는 다른 WebSocket 호스팅을 권장합니다.

## 보안 원칙

클라이언트는 행동 의도만 전송합니다. 덱, 상대 개인카드, 행동 유효성, 베팅 금액, 족보 및 팟 정산은 서버가 결정합니다. 현재 MVP는 메모리 기반 방 저장소이므로 운영 시 Redis/Postgres와 인증 토큰 저장소로 교체해야 합니다.
