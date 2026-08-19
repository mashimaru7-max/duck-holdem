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
          {!nickname && <small className="input-hint">닉네임을 입력하면 방을 만들거나 참가할 수 있어요.</small>}
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
              참가 가능한 방 <span>{rooms.length}</span>
            </h2>
            {rooms.length === 0 ? (
              <div className="empty-rooms">
                🦆<b>아직 열린 방이 없어요</b>
                <small>새 방을 만들면 친구들에게 바로 보여요.</small>
              </div>
            ) : (
              rooms.map((room) => (
                <button
                  className="room-card"
                  key={room.roomCode}
                  disabled={!nickname}
                  onClick={() => join(room.roomCode)}
                >
                  <span className="room-duck">🏠</span>
                  <span>
                    <b>{room.hostNickname}의 방</b>
                    <small>방 번호 {room.roomCode}</small>
                  </span>
                  <strong>
                    {room.playerCount}/{room.capacity} 참가
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

  const me = state.players.find((player) => player.id === state.myPlayerId)!;
  const turnPlayer = state.players.find(
    (player) => player.seat === state.actionSeat,
  );
  const myTurn = turnPlayer?.id === me.id;
  const allInRunout =
    !turnPlayer && ["PREFLOP", "FLOP", "TURN", "RIVER"].includes(state.status);
  const secondsLeft = state.deadlineAt
    ? Math.max(0, Math.ceil((state.deadlineAt - now) / 1000))
    : 0;
  const toCall = Math.max(0, state.currentBet - me.streetBet);
  const pot = state.players.reduce(
    (sum, player) => sum + player.totalContribution,
    0,
  );
  const targetDouble = Math.min(
    me.streetBet + me.stack,
    Math.max(state.currentBet * 2, state.currentBet + state.minRaise),
  );
  const targetHalf = Math.min(
    me.streetBet + me.stack,
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
  const showdownPlayers = state.players.filter(
    (player) => state.result?.reason === "showdown" && player.cardsVisible?.length,
  );
  const survivors = state.players.filter((player) => player.stack > 0).length;
  const leave = () => {
    if (state.status === "WAITING" || state.status === "HAND_END") {
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
    <main className="game">
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
                className={`seat seat-${player.seat} ${player.id === me.id ? "local" : ""} ${player.folded ? "folded" : ""} ${state.actionSeat === player.seat ? "turn" : ""} ${state.status === "WAITING" && player.ready ? "ready" : ""}`}
              >
                <div className="avatar">{ducks[index % ducks.length]}</div>
                {state.actionSeat === player.seat && (
                  <div className="betting-badge">BETTING · {secondsLeft}s</div>
                )}
                <div className="tag">
                  <b>{player.id === me.id ? "나 (로컬)" : player.nickname}</b>
                  <span>
                    {state.status === "WAITING"
                      ? player.ready
                        ? "✓ 준비 완료"
                        : "준비 중"
                      : player.lastAction ?? `칩 ${player.stack}`}
                  </span>
                </div>
                {player.id !== me.id && state.status !== "WAITING" && (
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
          <div className="mine">
            <div className="hole">
              <CardView card={state.myCards[0]} />
              <CardView card={state.myCards[1]} />
            </div>
            <div className={`turn-pill ${myTurn ? "active" : ""}`}>
              {state.status === "WAITING"
                ? me.ready
                  ? "✓ 준비 완료 · 다른 오리를 기다리는 중"
                  : "준비 버튼을 눌러주세요"
                : state.status === "HAND_END"
                  ? "게임 종료 · 결과를 확인하세요"
                  : allInRunout
                    ? "올인 · 카드를 순서대로 공개합니다"
                  : myTurn
                    ? `내 차례 · ${secondsLeft}초 안에 선택하세요`
                    : `${turnPlayer?.nickname ?? "다른 오리"}의 차례`}
            </div>
          </div>
          <div className="actions">
            {state.status === "WAITING" ? (
              <>
                <button
                  onClick={() =>
                    send({ type: "ready", commandId: cmd(), ready: !me.ready })
                  }
                >
                  {me.ready ? "준비 취소" : "준비"}
                </button>
                {state.hostId === me.id && (
                  <button
                    className="yellow"
                    onClick={() => send({ type: "start", commandId: cmd() })}
                  >
                    게임 시작
                  </button>
                )}
              </>
            ) : state.status === "HAND_END" ? (
              <button className="result-wait" disabled>
                결과가 표시되었습니다
              </button>
            ) : (
              <>
                <button
                  className="danger"
                  disabled={!myTurn}
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
            <div className="result-backdrop">
              <section className="result-modal">
                <div className="trophy">🏆</div>
                <p>이번 판 결과</p>
                <h2>
                  {winners.map((winner) => winner.player?.nickname).join(", ")}{" "}
                  승리!
                </h2>
                {winners.map((winner) => (
                  <div className="winner-line" key={winner.playerId}>
                    <b>{winner.handName}</b>
                    <span>+{winner.amount}칩</span>
                  </div>
                ))}
                {showdownPlayers.length > 0 && (
                  <section className="showdown-hands">
                    <h3>쇼다운 카드 공개</h3>
                    {showdownPlayers.map((player) => {
                      const won = winners.some((winner) => winner.playerId === player.id);
                      return (
                        <div className={`showdown-player ${won ? "won" : "lost"}`} key={player.id}>
                          <b>{player.nickname}</b>
                          <div className="showdown-cards">
                            {player.cardsVisible!.map((card) => <CardView key={card} card={card} />)}
                          </div>
                          <span>{won ? "승리" : "패배"}</span>
                        </div>
                      );
                    })}
                  </section>
                )}
                <p className="result-note">
                  {survivors < 2
                    ? "최종 승자가 결정되었습니다."
                    : "카드를 확인한 뒤 다음 판을 준비하세요."}
                </p>
                {state.hostId === me.id ? (
                  <button
                    onClick={() =>
                      send({
                        type: "continue",
                        commandId: cmd(),
                        reset: survivors < 2,
                      })
                    }
                  >
                    {survivors < 2 ? "새 게임 시작" : "다음 판 준비"}
                  </button>
                ) : (
                  <small>방장이 다음 게임을 준비하고 있습니다.</small>
                )}
                <button className="secondary" onClick={leave}>
                  로비로
                </button>
              </section>
            </div>
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
              <small
                className={
                  state.status === "WAITING"
                    ? player.ready
                      ? "ready-state done"
                      : "ready-state"
                    : ""
                }
              >
                {state.status === "WAITING"
                  ? player.ready
                    ? "준비 완료"
                    : "준비 중"
                  : player.stack}
              </small>
              <i className={player.connected ? "on" : ""} />
              {state.hostId === me.id &&
                player.id !== me.id &&
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
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
