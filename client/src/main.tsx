import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  ActionKind,
  Card,
  ClientMessage,
  GameView,
  RoomSummary,
  ServerMessage,
} from "@duck-holdem/shared";
import "./styles.css";

const WS = import.meta.env.VITE_WS_URL || "ws://localhost:8787/ws";
const ducks = ["😎", "🧢", "🤓", "🎧", "⚓", "🌻", "🔥", "😴"];
const suit: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

function CardView({ card, empty = false }: { card?: Card; empty?: boolean }) {
  if (empty) return <div className="card empty">🦆</div>;
  if (!card) return <div className="card back">🦆</div>;
  const red = card[1] === "H" || card[1] === "D";
  const rank = card[0] === "T" ? "10" : card[0];
  return (
    <div className={`card ${red ? "red" : ""}`}>
      <b>{rank}</b>
      <span>{suit[card[1]]}</span>
    </div>
  );
}

function App() {
  const [state, setState] = useState<GameView>();
  const [screen, setScreen] = useState<"lobby" | "game">("lobby");
  const [name, setName] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  const stateRef = useRef<GameView | undefined>(undefined);
  const session = useMemo(
    () =>
      localStorage.duckSession ??
      (localStorage.duckSession = crypto.randomUUID()),
    [],
  );

  useEffect(() => {
    const sock = new WebSocket(WS);
    ws.current = sock;
    sock.onopen = () => setOnline(true);
    sock.onclose = () => setOnline(false);
    sock.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "state") {
        setState(message.state);
        setScreen("game");
        setError("");
      } else if (message.type === "room_list") setRooms(message.rooms);
      else if (message.type === "kicked") {
        setState(undefined);
        setScreen("lobby");
        setError(message.message);
      } else if (message.type === "error") setError(message.message);
    };
    return () => sock.close();
  }, []);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    const leaveOnClose = () => {
      const current = stateRef.current;
      if (
        current &&
        (current.isSpectator || current.status === "WAITING" || current.status === "HAND_END")
      ) {
        ws.current?.send(
          JSON.stringify({ type: "leave", commandId: crypto.randomUUID() }),
        );
      }
      ws.current?.close();
    };
    window.addEventListener("pagehide", leaveOnClose);
    window.addEventListener("beforeunload", leaveOnClose);
    return () => {
      window.removeEventListener("pagehide", leaveOnClose);
      window.removeEventListener("beforeunload", leaveOnClose);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const send = (message: ClientMessage) =>
    ws.current?.readyState === 1 && ws.current.send(JSON.stringify(message));
  const cmd = () => crypto.randomUUID();
  const nickname = name.trim();
  const requireNickname = () => {
    if (nickname) return true;
    setError("입장할 닉네임을 먼저 입력해 주세요.");
    return false;
  };
  const join = (roomCode: string) => {
    if (!requireNickname()) return;
    send({
      type: "join_room",
      commandId: cmd(),
      nickname,
      roomCode,
      sessionId: session,
    });
  };
  const spectate = (roomCode: string) => {
    if (!requireNickname()) return;
    send({type:"spectate_room",commandId:cmd(),nickname,roomCode,sessionId:session});
  };

  if (screen === "lobby" || !state)
    return (
      <main className="lobby">
        <section className="welcome lobby-panel">
          <div className="hero-duck">🦆</div>
          <p className="kicker">GO-GO! DUCK</p>
          <h1>DUCK HOLD'EM</h1>
          <p>친구들과 즐기는 2~8인 실시간 홀덤</p>
          <label>
            닉네임
            <input
              value={name}
              maxLength={12}
              placeholder="닉네임을 입력해 주세요"
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim()) setError("");
              }}
            />
          </label>
          {!nickname && (
            <small className="input-hint">
              닉네임을 입력하면 방을 만들거나 참가할 수 있어요.
            </small>
          )}
          <button
            disabled={!nickname}
            onClick={() => {
              if (!requireNickname()) return;
              send({
                type: "create_room",
                commandId: cmd(),
                nickname,
                sessionId: session,
              });
            }}
          >
            새 방 만들기
          </button>
          <section className="room-browser">
            <h2>
              방 목록 <span>{rooms.length}</span>
            </h2>
            {rooms.length === 0 ? (
              <div className="empty-rooms">
                🦆<b>아직 열린 방이 없어요</b>
                <small>새 방을 만들면 친구들에게 바로 보여요.</small>
              </div>
            ) : (
              rooms.map((room) => (
                <button
                  className={`room-card ${room.status !== "WAITING" && room.status !== "HAND_END" ? "watch-room" : ""}`}
                  key={room.roomCode}
                  disabled={!nickname}
                  onClick={() => room.status === "WAITING" || room.status === "HAND_END" ? join(room.roomCode) : spectate(room.roomCode)}
                >
                  <span className="room-duck">🏠</span>
                  <span>
                    <b>{room.hostNickname}의 방</b>
                    <small>{room.status === "WAITING" ? "입장 가능" : room.status === "HAND_END" ? "게임 종료 · 입장 가능" : "게임 중 · 관전 가능"} · 방 {room.roomCode}</small>
                  </span>
                  <strong>
                    {room.status === "WAITING" || room.status === "HAND_END" ? `${room.playerCount}/${room.capacity} 참가` : `👁 ${room.spectatorCount} · 관전`}
                  </strong>
                </button>
              ))
            )}
          </section>
          {error && <p className="error">{error}</p>}
          <small>
            <i className={online ? "on" : ""} />
            {online ? "서버 연결됨" : "서버 연결 중"}
          </small>
        </section>
      </main>
    );

  const me = state.players.find((player) => player.id === state.myPlayerId);
  const turnPlayer = state.players.find(
    (player) => player.seat === state.actionSeat,
  );
  const myTurn = !state.isSpectator && turnPlayer?.id === state.myPlayerId;
  const allInRunout =
    !turnPlayer && ["PREFLOP", "FLOP", "TURN", "RIVER"].includes(state.status);
  const secondsLeft = state.deadlineAt
    ? Math.max(0, Math.ceil((state.deadlineAt - now) / 1000))
    : 0;
  const toCall = Math.max(0, state.currentBet - (me?.streetBet ?? 0));
  const pot = state.players.reduce(
    (sum, player) => sum + player.totalContribution,
    0,
  );
  const targetDouble = Math.min(
    (me?.streetBet ?? 0) + (me?.stack ?? 0),
    Math.max(state.currentBet * 2, state.currentBet + state.minRaise),
  );
  const targetHalf = Math.min(
    (me?.streetBet ?? 0) + (me?.stack ?? 0),
    Math.max(
      state.currentBet + state.minRaise,
      state.currentBet + Math.ceil(pot / 2),
    ),
  );
  const act = (action: ActionKind) =>
    send({
      type: "action",
      commandId: cmd(),
      expectedVersion: state.version,
      action,
    });
  const winners = (state.result?.winners ?? []).map((winner) => ({
    ...winner,
    player: state.players.find((player) => player.id === winner.playerId)!,
  }));
  const survivors = state.players.filter((player) => player.stack > 0).length;
  const leave = () => {
    if (state.isSpectator || state.status === "WAITING" || state.status === "HAND_END") {
      send({ type: "leave", commandId: cmd() });
      setState(undefined);
      setScreen("lobby");
    } else setError("게임 중에는 방을 나갈 수 없습니다.");
  };
  const kick = (playerId: string, nickname: string) => {
    if (window.confirm(`${nickname} 님을 방에서 내보낼까요?`))
      send({ type: "kick", commandId: cmd(), playerId });
  };

  return (
    <main className={`game ${state.status === "HAND_END" ? "hand-end" : ""}`}>
      <header>
        <button className="icon" onClick={leave}>
          ←
        </button>
        <div>
          <h1>DUCK HOLD'EM</h1>
          <span>방 {state.roomCode}</span>
        </div>
        <span className="connection">
          <i className={online ? "on" : ""} />
          {online ? "연결 양호" : "재연결 중"}
        </span>
      </header>
      <div className="layout">
        <section className="table-wrap">
          {turnPlayer && (
            <div className={`turn-banner ${myTurn ? "mine-turn" : ""}`}>
              <span>🎯 현재 베팅</span>
              <b>{myTurn ? "내 차례" : `${turnPlayer.nickname} 차례`}</b>
              <em className={secondsLeft <= 10 ? "urgent" : ""}>
                {secondsLeft}초
              </em>
            </div>
          )}
          {allInRunout && (
            <div className="turn-banner runout-banner">
              <span>🃏 ALL-IN</span>
              <b>커뮤니티 카드 공개 중</b>
              <em>자동 진행</em>
            </div>
          )}
          <div className="poker-table">
            <div className="pot">
              <b>
                POT <em>{state.pot}</em>
              </b>
              <span>현재 베팅 {state.currentBet}</span>
            </div>
            <div className="board">
              {Array.from({ length: 5 }, (_, index) => (
                <CardView
                  key={`${index}-${state.board[index] ?? "empty"}`}
                  card={state.board[index]}
                  empty={!state.board[index]}
                />
              ))}
            </div>
            {state.players.map((player, index) => (
              <div
                key={player.id}
                className={`seat seat-${player.seat} ${player.id === state.myPlayerId ? "local" : ""} ${player.folded ? "folded" : ""} ${state.actionSeat === player.seat ? "turn" : ""}`}
              >
                <div className="avatar">{ducks[index % ducks.length]}</div>
                {state.actionSeat === player.seat && (
                  <div className="betting-badge">▶ 현재 턴 · {secondsLeft}초</div>
                )}
                {player.lastAction && (
                  <div className="action-bubble" key={`${player.id}-${player.lastAction}`}>
                    {player.lastAction}
                  </div>
                )}
                <div className="tag">
                  <b>{player.id === state.myPlayerId ? "나 (로컬)" : player.nickname}</b>
                  <span>{player.lastAction ?? "액션 대기"}</span>
                  <small>보유 칩 {player.stack}</small>
                </div>
                {player.id !== state.myPlayerId && state.status !== "WAITING" && (
                  <div className="mini-cards">
                    {player.cardsVisible?.length ? (
                      player.cardsVisible.map((card) => (
                        <CardView key={card} card={card} />
                      ))
                    ) : (
                      <>
                        <CardView />
                        <CardView />
                      </>
                    )}
                  </div>
                )}
                <div className="markers">
                  {player.seat === state.dealerSeat && <i>D</i>}
                  {player.seat === state.sbSeat && <i>SB</i>}
                  {player.seat === state.bbSeat && <i>BB</i>}
                </div>
              </div>
            ))}
          </div>
          <div className={`mine ${state.isSpectator ? "spectator-mine" : ""}`}>
            {!state.isSpectator && <div className="hole"><CardView card={state.myCards[0]} /><CardView card={state.myCards[1]} /></div>}
            <div className={`turn-pill ${myTurn ? "active" : ""}`}>
              {state.isSpectator
                ? (state.status === "HAND_END" || state.status === "WAITING") && state.players.length < 8
                  ? "관전 종료 · 빈 좌석에 참여할 수 있습니다"
                  : `👁 관전 중 · 관전자 ${state.spectatorCount}명`
                : state.status === "WAITING"
                ? state.hostId === state.myPlayerId
                  ? "2명 이상이면 게임을 시작할 수 있습니다"
                  : "방장이 게임을 시작할 때까지 기다려주세요"
                : state.status === "HAND_END"
                  ? "게임 종료 · 결과를 확인하세요"
                  : allInRunout
                    ? "올인 · 카드를 순서대로 공개합니다"
                    : myTurn
                      ? `내 차례 · ${secondsLeft}초 안에 선택하세요`
                      : `${turnPlayer?.nickname ?? "다른 오리"}의 차례`}
            </div>
          </div>
          <div className={`actions ${myTurn ? "my-actions" : ""}`}>
            {state.isSpectator ? (
              (state.status === "HAND_END" || state.status === "WAITING") && state.players.length < 8 ? <button className="yellow spectator-join" onClick={()=>send({type:"join_game",commandId:cmd()})}>게임 참여</button> : <button disabled>관전 중</button>
            ) : state.status === "WAITING" ? (
              <>
                {state.hostId === state.myPlayerId ? (
                  <button
                    className="yellow"
                    disabled={state.players.length < 2}
                    onClick={() => send({ type: "start", commandId: cmd() })}
                  >
                    게임 시작
                  </button>
                ) : (
                  <button disabled>방장의 게임 시작을 기다리는 중</button>
                )}
              </>
            ) : state.status === "HAND_END" ? null : (
              <>
                <button
                  className="danger"
                  disabled={!myTurn || toCall === 0}
                  title={toCall === 0 ? "베팅이 없을 때는 체크해 주세요" : "폴드"}
                  onClick={() => act("fold")}
                >
                  폴드
                </button>
                <button
                  disabled={!myTurn || toCall > 0}
                  onClick={() => act("check")}
                >
                  체크
                </button>
                <button
                  disabled={!myTurn || toCall === 0}
                  onClick={() => act("call")}
                >
                  콜 {toCall}
                </button>
                <button
                  className="yellow"
                  disabled={!myTurn}
                  onClick={() => act("double")}
                >
                  따당 {targetDouble}
                </button>
                <button
                  className="yellow"
                  disabled={!myTurn}
                  onClick={() => act("half")}
                >
                  하프 {targetHalf}
                </button>
                <button
                  className="danger"
                  disabled={!myTurn}
                  onClick={() => act("allin")}
                >
                  올인
                </button>
              </>
            )}
          </div>
          {state.status === "HAND_END" && state.result && (
            <section className="table-result">
              <div className="table-result-title">
                <span>🏆</span>
                <div>
                  <b>
                    {winners
                      .map((winner) => winner.player?.nickname)
                      .join(", ")}{" "}
                    승리!
                  </b>
                  <small>
                    {winners
                      .map(
                        (winner) => `${winner.handName} · +${winner.amount}칩`,
                      )
                      .join(" / ")}
                  </small>
                </div>
              </div>
              <div className="table-result-actions">
                {state.hostId === state.myPlayerId ? (
                  <button
                    onClick={() =>
                      send({
                        type: "continue",
                        commandId: cmd(),
                        reset: survivors < 2,
                      })
                    }
                  >
                    {survivors < 2 ? "새 게임" : "다음 판"}
                  </button>
                ) : (
                  <small>방장이 다음 판을 준비하고 있습니다.</small>
                )}
                <button className="secondary" onClick={leave}>
                  로비로
                </button>
              </div>
            </section>
          )}
          {error && <p className="toast">{error}</p>}
        </section>
        <aside>
          <h2>플레이어 {state.players.length}/8</h2>
          {state.players.map((player, index) => (
            <div
              className={`player-row ${state.actionSeat === player.seat ? "acting" : ""}`}
              key={player.id}
            >
              <span>{ducks[index % ducks.length]}</span>
              <b>
                {player.nickname}
                {player.id === state.hostId ? " 👑" : ""}
              </b>
              <small>{player.stack}</small>
              <i className={player.connected ? "on" : ""} />
              {state.hostId === state.myPlayerId &&
                player.id !== state.myPlayerId &&
                state.status === "WAITING" && (
                  <button
                    className="kick"
                    onClick={() => kick(player.id, player.nickname)}
                  >
                    강퇴
                  </button>
                )}
            </div>
          ))}
        </aside>
        {state.spectatorCount > 0 && <div className="spectator-count">👁 관전자 {state.spectatorCount}명</div>}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
