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
const BIG_BLIND = 2;
const DEFAULT_RAISE_TO = BIG_BLIND * 2;
const ducks = ["😎", "🧢", "🤓", "🎧", "⚓", "🌻", "🔥", "😴"];
const suit: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const streetName: Record<GameView["status"], string> = {
  WAITING: "대기 중",
  PREFLOP: "프리플랍",
  FLOP: "플랍",
  TURN: "턴",
  RIVER: "리버",
  SHOWDOWN: "쇼다운",
  HAND_END: "게임 결과",
};

function makeRaiseOptions(minimum: number, maximum: number) {
  if (maximum < minimum) return [];
  const values = new Set<number>([minimum]);
  if (DEFAULT_RAISE_TO >= minimum && DEFAULT_RAISE_TO <= maximum)
    values.add(DEFAULT_RAISE_TO);
  for (let amount = Math.ceil(minimum / 5) * 5; amount <= maximum; amount += 5)
    values.add(amount);
  return [...values].sort((left, right) => left - right);
}

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
  const [raiseTo, setRaiseTo] = useState(0);
  const [bgmEnabled, setBgmEnabled] = useState(
    () => localStorage.duckBgm !== "off",
  );
  const ws = useRef<WebSocket | null>(null);
  const stateRef = useRef<GameView | undefined>(undefined);
  const gameHistoryActive = useRef(false);
  const exitStarted = useRef(false);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const session = useMemo(
    () =>
      localStorage.duckSession ??
      (localStorage.duckSession = crypto.randomUUID()),
    [],
  );

  const startBgm = () => {
    if (!bgmRef.current) {
      const audio = new Audio(
        `${import.meta.env.BASE_URL}audio/plains-stage-bpm125.ogg`,
      );
      audio.loop = true;
      audio.volume = 0.16;
      bgmRef.current = audio;
    }
    void bgmRef.current.play().catch(() => undefined);
  };

  useEffect(() => {
    const sock = new WebSocket(WS);
    ws.current = sock;
    sock.onopen = () => setOnline(true);
    sock.onclose = () => setOnline(false);
    sock.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "state") {
        if (exitStarted.current) return;
        if (!gameHistoryActive.current) {
          window.history.pushState({ duckHoldemGame: true }, "");
          gameHistoryActive.current = true;
        }
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
      if (exitStarted.current) return;
      exitStarted.current = true;
      const current = stateRef.current;
      const socket = ws.current;
      if (current && socket?.readyState === WebSocket.OPEN) {
        try {
          socket.send(
            JSON.stringify({ type: "leave", commandId: crypto.randomUUID() }),
          );
        } catch {
          // The server also folds the player when the socket closes.
        }
      }
      gameHistoryActive.current = false;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
    const leaveOnBack = () => {
      if (!gameHistoryActive.current || !stateRef.current) return;
      exitStarted.current = true;
      gameHistoryActive.current = false;
      if (ws.current?.readyState === WebSocket.OPEN)
        ws.current.send(
          JSON.stringify({ type: "leave", commandId: crypto.randomUUID() }),
        );
      setState(undefined);
      setScreen("lobby");
    };
    window.addEventListener("pagehide", leaveOnClose);
    window.addEventListener("beforeunload", leaveOnClose);
    window.addEventListener("popstate", leaveOnBack);
    return () => {
      window.removeEventListener("pagehide", leaveOnClose);
      window.removeEventListener("beforeunload", leaveOnClose);
      window.removeEventListener("popstate", leaveOnBack);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    localStorage.duckBgm = bgmEnabled ? "on" : "off";
    if (!bgmEnabled) {
      bgmRef.current?.pause();
      return;
    }
    const begin = () => startBgm();
    window.addEventListener("pointerdown", begin, { once: true });
    window.addEventListener("keydown", begin, { once: true });
    return () => {
      window.removeEventListener("pointerdown", begin);
      window.removeEventListener("keydown", begin);
    };
  }, [bgmEnabled]);
  useEffect(
    () => () => {
      if (!bgmRef.current) return;
      bgmRef.current.pause();
      bgmRef.current.removeAttribute("src");
    },
    [],
  );
  useEffect(() => {
    if (!state || state.isSpectator) return;
    const player = state.players.find(
      (candidate) => candidate.id === state.myPlayerId,
    );
    if (!player) return;
    const maximum = player.streetBet + player.stack;
    const legalMinimum = state.currentBet + state.minRaise;
    const options = makeRaiseOptions(legalMinimum, maximum);
    setRaiseTo(
      options.includes(DEFAULT_RAISE_TO)
        ? DEFAULT_RAISE_TO
        : (options[0] ?? 0),
    );
  }, [state?.version, state?.myPlayerId, state?.isSpectator]);

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
    exitStarted.current = false;
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
    exitStarted.current = false;
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
              exitStarted.current = false;
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
                  className={`room-card ${room.status !== "WAITING" ? "watch-room" : ""}`}
                  key={room.roomCode}
                  disabled={!nickname}
                  onClick={() => room.status === "WAITING" ? join(room.roomCode) : spectate(room.roomCode)}
                >
                  <span className="room-duck">🏠</span>
                  <span>
                    <b>{room.hostNickname}의 방</b>
                    <small>{room.status === "WAITING" ? "입장 가능" : room.status === "HAND_END" ? "토너먼트 결과 · 관전 가능" : "토너먼트 진행 중 · 관전 가능"} · 방 {room.roomCode}</small>
                  </span>
                  <strong>
                    {room.status === "WAITING" ? `${room.playerCount}/${room.capacity} 참가` : `👁 ${room.spectatorCount} · 관전`}
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
  const isEliminated = me?.eliminated === true;
  const tournamentWinner = state.players.find(
    (player) => player.id === state.tournamentWinnerId,
  );
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
  const legalRaiseMin = state.currentBet + state.minRaise;
  const raiseOptions = makeRaiseOptions(
    legalRaiseMin,
    (me?.streetBet ?? 0) + (me?.stack ?? 0),
  );
  const raiseMin = raiseOptions[0] ?? 0;
  const raiseMax = raiseOptions.at(-1) ?? 0;
  const raiseRightsOpen = me?.raiseAllowed !== false;
  const canRaise = myTurn && raiseRightsOpen && raiseOptions.length > 0;
  const canAllInRaise =
    myTurn && (raiseRightsOpen || (me?.stack ?? 0) <= toCall);
  const opponents = state.players
    .filter((player) => player.id !== state.myPlayerId)
    .sort(
      (left, right) =>
        ((left.seat - (me?.seat ?? 0) + 8) % 8) -
        ((right.seat - (me?.seat ?? 0) + 8) % 8),
    );
  const opponentSeatLayouts: Record<number, number[]> = {
    0: [],
    1: [1],
    2: [8, 2],
    3: [8, 1, 2],
    4: [7, 8, 2, 3],
    5: [7, 8, 1, 2, 3],
    6: [6, 7, 8, 2, 3, 4],
    7: [6, 7, 8, 1, 2, 3, 4],
  };
  const visualSeats = new Map(
    opponents.map((player, index) => [
      player.id,
      opponentSeatLayouts[opponents.length][index],
    ]),
  );
  const tablePlayers = (state.isSpectator ? state.players : opponents).filter(
    (player) => !player.eliminated,
  );
  const visualSeatFor = (player: GameView["players"][number]) =>
    state.isSpectator ? player.seat : visualSeats.get(player.id) ?? player.seat;
  const act = (action: ActionKind, amount?: number) =>
    send({
      type: "action",
      commandId: cmd(),
      expectedVersion: state.version,
      action,
      raiseTo: amount,
    });
  const winners = (state.result?.winners ?? []).map((winner) => ({
    ...winner,
    player: state.players.find((player) => player.id === winner.playerId)!,
  }));
  const refunds = (state.result?.refunds ?? []).map((refund) => ({
    ...refund,
    player: state.players.find((player) => player.id === refund.playerId),
  }));
  const isFoldWinner =
    state.result?.reason === "fold" &&
    state.result.winners[0]?.playerId === state.myPlayerId;
  const isPlaying =
    !state.isSpectator &&
    !isEliminated &&
    !["WAITING", "HAND_END"].includes(state.status);
  const leave = () => {
    if (
      isPlaying &&
      !window.confirm("게임 중 나가면 즉시 폴드됩니다. 로비로 나갈까요?")
    )
      return;
    exitStarted.current = true;
    send({ type: "leave", commandId: cmd() });
    setState(undefined);
    setScreen("lobby");
    if (gameHistoryActive.current) {
      gameHistoryActive.current = false;
      window.history.back();
    }
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
        <div className="header-controls">
          <button
            className={`sound-toggle ${bgmEnabled ? "playing" : ""}`}
            aria-label={bgmEnabled ? "배경음악 끄기" : "배경음악 켜기"}
            title={bgmEnabled ? "배경음악 끄기" : "배경음악 켜기"}
            onClick={() => {
              if (!bgmEnabled) startBgm();
              setBgmEnabled((enabled) => !enabled);
            }}
          >
            {bgmEnabled ? "♫" : "♩"}
          </button>
          <span className="connection">
            <i className={online ? "on" : ""} />
            {online ? "연결 양호" : "재연결 중"}
          </span>
        </div>
      </header>
      <div className="layout">
        <section className="table-wrap">
          <div className="mobile-status-row">
            <div className="turn-banner-slot">
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
            </div>
            <details className="mobile-players">
              <summary>
                <span>플레이어 {state.players.length}/8</span>
                <small>{turnPlayer ? `${secondsLeft}초` : streetName[state.status]}</small>
              </summary>
              <div className="mobile-player-list">
                {state.players.map((player, index) => (
                  <div
                    className={`mobile-player ${state.actionSeat === player.seat ? "acting" : ""} ${player.eliminated ? "eliminated" : ""}`}
                    key={player.id}
                  >
                    <span>{ducks[index % ducks.length]}</span>
                    <b>
                      {player.nickname}
                      {player.id === state.hostId ? " 👑" : ""}
                    </b>
                    <small>{player.eliminated ? "탈락" : `${player.stack}칩`}</small>
                    <i className={player.connected ? "on" : ""} />
                  </div>
                ))}
              </div>
            </details>
          </div>
          <div className="poker-table">
            <div className="pot">
              <small className="street-chip">{streetName[state.status]}</small>
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
            {tablePlayers.map((player) => {
              const playerIndex = state.players.findIndex(
                (candidate) => candidate.id === player.id,
              );
              return (
              <div
                key={player.id}
                className={`seat seat-${visualSeatFor(player)} ${player.folded ? "folded" : ""} ${state.actionSeat === player.seat ? "turn" : ""}`}
              >
                <div className="avatar">{ducks[playerIndex % ducks.length]}</div>
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
              );
            })}
          </div>
          <div className={`mine ${state.isSpectator ? "spectator-mine" : ""}`}>
            {!state.isSpectator && !isEliminated && state.status !== "WAITING" && (
              <div className="my-hand">
                <span>내 카드 · {me?.stack ?? 0}칩</span>
                <div className="hole">
                  <CardView card={state.myCards[0]} />
                  <CardView card={state.myCards[1]} />
                </div>
                {state.myHandName && (
                  <small className="current-hand-name">
                    현재 족보 · <b>{state.myHandName}</b>
                  </small>
                )}
              </div>
            )}
            <div className="player-status-row">
              <div className={`turn-pill ${myTurn ? "active" : ""}`}>
                {state.isSpectator
                  ? state.status === "HAND_END" && tournamentWinner && state.players.length < 8
                    ? "토너먼트 종료 · 다음 대회에 참여할 수 있습니다"
                    : `👁 관전 중 · 관전자 ${state.spectatorCount}명`
                  : state.status === "WAITING"
                  ? state.hostId === state.myPlayerId
                    ? "2명 이상이면 게임을 시작할 수 있습니다"
                    : "방장이 게임을 시작할 때까지 기다려주세요"
                  : state.status === "HAND_END"
                    ? tournamentWinner
                      ? `🏆 ${tournamentWinner.nickname} 토너먼트 우승!`
                      : "이번 판 종료 · 다음 판을 준비하세요"
                    : isEliminated
                      ? "🏁 토너먼트 탈락 · 관전 중"
                    : allInRunout
                      ? "올인 · 카드를 순서대로 공개합니다"
                      : myTurn
                        ? `내 차례 · ${secondsLeft}초 안에 선택하세요`
                        : `${turnPlayer?.nickname ?? "다른 오리"}의 차례`}
              </div>
              {isPlaying && (
                <button className="fold-leave-button" onClick={leave}>
                  🚪 폴드 후 나가기
                </button>
              )}
            </div>
          </div>
          <div className={`actions action-dock ${myTurn ? "my-actions" : ""}`}>
            {state.isSpectator ? (
              state.status === "HAND_END" && tournamentWinner && state.players.length < 8 ? <button className="yellow spectator-join" onClick={()=>send({type:"join_game",commandId:cmd()})}>다음 토너먼트 참여</button> : <button disabled>관전 중</button>
            ) : isEliminated && state.status !== "HAND_END" ? (
              <button disabled>🏁 토너먼트 탈락 · 관전 중</button>
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
                  className="danger action-fold"
                  disabled={!myTurn || toCall === 0}
                  title={toCall === 0 ? "베팅이 없을 때는 체크해 주세요" : "폴드"}
                  onClick={() => act("fold")}
                >
                  폴드
                </button>
                <button
                  className="action-check"
                  disabled={!myTurn || toCall > 0}
                  onClick={() => act("check")}
                >
                  체크
                </button>
                <button
                  className="action-call"
                  disabled={!myTurn || toCall === 0}
                  onClick={() => act("call")}
                >
                  콜 {toCall}
                </button>
                <div className={`raise-control ${canRaise ? "enabled" : ""}`}>
                  <label htmlFor="raise-slider">
                    <span>레이즈 금액</span>
                    <b>{canRaise ? raiseTo : "불가"}</b>
                  </label>
                  <input
                    id="raise-slider"
                    type="range"
                    min="0"
                    max={canRaise ? raiseOptions.length - 1 : 0}
                    step="1"
                    value={canRaise ? Math.max(0, raiseOptions.indexOf(raiseTo)) : 0}
                    disabled={!canRaise}
                    onChange={(event) =>
                      setRaiseTo(raiseOptions[Number(event.target.value)] ?? raiseMin)
                    }
                  />
                  <div className="raise-scale" aria-hidden="true">
                    <span>{canRaise ? raiseMin : "-"}</span>
                    <span>기본 2BB · 이후 5칩</span>
                    <span>{canRaise ? raiseMax : "-"}</span>
                  </div>
                </div>
                <button
                  className="yellow action-raise"
                  disabled={!canRaise}
                  onClick={() => act("raise", raiseTo)}
                >
                  레이즈 {canRaise ? raiseTo : ""}
                </button>
                <button
                  className="danger action-allin"
                  disabled={!canAllInRaise}
                  title={
                    !raiseRightsOpen
                      ? "짧은 올인 뒤에는 다시 레이즈할 수 없습니다"
                      : "보유 칩 전부 베팅"
                  }
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
                <span>{tournamentWinner ? "👑" : "🏆"}</span>
                <div>
                  {tournamentWinner && (
                    <strong className="tournament-champion">
                      {tournamentWinner.nickname} 토너먼트 최종 우승!
                    </strong>
                  )}
                  <b>
                    {winners.map((winner) => winner.player?.nickname).join(", ")}{" "}
                    {winners.length > 1 ? "공동 승리!" : "승리!"}
                  </b>
                  <small>
                    {winners
                      .map(
                        (winner) => `${winner.handName} · +${winner.amount}칩`,
                      )
                      .join(" / ")}
                  </small>
                  {refunds.length > 0 && (
                    <small className="refund-line">
                      {refunds.map((refund) => `${refund.player?.nickname} 미사용 베팅 ${refund.amount}칩 반환`).join(" / ")}
                    </small>
                  )}
                </div>
              </div>
              {state.result.reason === "fold" && (
                <div className="reveal-choice">
                  {isFoldWinner && !state.result.revealDecision ? (
                    <><b>승리 패를 공개할까요?</b><button onClick={()=>send({type:"reveal_cards",commandId:cmd(),reveal:true})}>패 공개</button><button className="secondary" onClick={()=>send({type:"reveal_cards",commandId:cmd(),reveal:false})}>공개하지 않음</button></>
                  ) : (
                    <small>{state.result.revealDecision === "shown" ? "승자가 패를 공개했습니다." : state.result.revealDecision === "hidden" ? "승자가 패를 공개하지 않았습니다." : "승자가 패 공개 여부를 선택하고 있습니다."}</small>
                  )}
                </div>
              )}
              <div className="table-result-actions">
                {state.hostId === state.myPlayerId ? (
                  <button
                    disabled={
                      state.result.reason === "fold" &&
                      !state.result.revealDecision
                    }
                    onClick={() =>
                      send({
                        type: "continue",
                        commandId: cmd(),
                        reset: Boolean(tournamentWinner),
                      })
                    }
                  >
                    {tournamentWinner ? "새 토너먼트" : "다음 판 시작"}
                  </button>
                ) : (
                  <small>
                    {tournamentWinner
                      ? "방장이 새 토너먼트를 준비하고 있습니다."
                      : "방장이 다음 판을 시작할 때까지 기다려주세요."}
                  </small>
                )}
                <button className="secondary" onClick={leave}>
                  로비로
                </button>
              </div>
            </section>
          )}
          {error && <p className="toast">{error}</p>}
        </section>
        <aside className="desktop-players">
          <div className="player-panel-heading">
            <div>
              <small>{streetName[state.status]}</small>
              <h2>플레이어 {state.players.length}/8</h2>
            </div>
            {turnPlayer && <span>{secondsLeft}초</span>}
          </div>
          {state.players.map((player, index) => (
            <div
              className={`player-row ${state.actionSeat === player.seat ? "acting" : ""} ${player.eliminated ? "eliminated" : ""}`}
              key={player.id}
            >
              <span>{ducks[index % ducks.length]}</span>
              <b>
                {player.nickname}
                {player.id === state.hostId ? " 👑" : ""}
              </b>
              <small>{player.eliminated ? "탈락" : player.stack}</small>
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
