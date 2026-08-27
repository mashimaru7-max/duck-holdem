import { randomUUID } from "node:crypto";
import type {
  ActionKind,
  Card,
  GameView,
  PublicPlayer,
  Street,
} from "@duck-holdem/shared";
import { createDeck, evaluate, compareScore, shuffle } from "./cards.js";

export interface Player extends PublicPlayer {
  sessionId: string;
  holeCards: Card[];
  acted: boolean;
}
export interface Room {
  code: string;
  hostId: string;
  status: Street;
  version: number;
  players: Player[];
  deck: Card[];
  board: Card[];
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  actionSeat?: number;
  pot: number;
  currentBet: number;
  minRaise: number;
  handId?: string;
  deadlineAt?: number;
  processed: Set<string>;
  result?: {
    winners: { playerId: string; amount: number; handName: string }[];
    refunds?: { playerId: string; amount: number }[];
    reason: "showdown" | "fold";
    revealDecision?: "shown" | "hidden";
  };
}
const nextSeat = (
  room: Room,
  from: number,
  predicate = (p: Player) => true,
) => {
  const seats = room.players
    .filter(predicate)
    .map((p) => p.seat)
    .sort((a, b) => a - b);
  return seats.find((s) => s > from) ?? seats[0];
};
export function newRoom(host: Player, code: string): Room {
  return {
    code,
    hostId: host.id,
    status: "WAITING",
    version: 0,
    players: [host],
    deck: [],
    board: [],
    dealerSeat: host.seat,
    sbSeat: host.seat,
    bbSeat: host.seat,
    pot: 0,
    currentBet: 0,
    minRaise: 2,
    processed: new Set(),
  };
}
export function newPlayer(
  nickname: string,
  sessionId: string,
  seat: number,
): Player {
  return {
    id: randomUUID(),
    sessionId,
    nickname,
    seat,
    stack: 100,
    ready: false,
    connected: true,
    folded: false,
    allIn: false,
    streetBet: 0,
    totalContribution: 0,
    holeCards: [],
    acted: false,
  };
}
function commit(p: Player, amount: number) {
  const paid = Math.min(p.stack, Math.max(0, amount));
  p.stack -= paid;
  p.streetBet += paid;
  p.totalContribution += paid;
  if (p.stack === 0) p.allIn = true;
  return paid;
}
function active(p: Player) {
  return !p.folded && !p.allIn;
}
export function startHand(room: Room, random = Math.random) {
  if (room.players.length < 2)
    throw new Error("게임 시작에는 2명 이상이 필요합니다.");
  room.handId = randomUUID();
  room.status = "PREFLOP";
  room.version++;
  room.deck = shuffle(createDeck(), random);
  room.board = [];
  room.pot = 0;
  room.currentBet = 2;
  room.minRaise = 2;
  room.result = undefined;
  room.players.forEach((p) => {
    p.folded = false;
    p.allIn = false;
    p.streetBet = 0;
    p.totalContribution = 0;
    p.holeCards = [room.deck.pop()!, room.deck.pop()!];
    p.acted = false;
    p.lastAction = undefined;
  });
  room.dealerSeat = nextSeat(room, room.dealerSeat);
  if (room.players.length === 2) {
    room.sbSeat = room.dealerSeat;
    room.bbSeat = nextSeat(room, room.sbSeat);
  } else {
    room.sbSeat = nextSeat(room, room.dealerSeat);
    room.bbSeat = nextSeat(room, room.sbSeat);
  }
  commit(room.players.find((p) => p.seat === room.sbSeat)!, 1);
  commit(room.players.find((p) => p.seat === room.bbSeat)!, 2);
  room.actionSeat =
    room.players.length === 2
      ? room.sbSeat
      : nextSeat(room, room.bbSeat, active);
  room.deadlineAt = Date.now() + 60_000;
}
function contenders(room: Room) {
  return room.players.filter((p) => !p.folded);
}
function bettingComplete(room: Room) {
  const a = room.players.filter(active);
  return (
    a.length === 0 || a.every((p) => p.acted && p.streetBet === room.currentBet)
  );
}
function awardUncontested(room: Room) {
  const winner = contenders(room)[0];
  const amount = room.players.reduce((s, p) => s + p.totalContribution, 0);
  winner.stack += amount;
  winner.lastAction = "승리";
  room.result = {
    winners: [{ playerId: winner.id, amount, handName: "상대 전원 폴드" }],
    reason: "fold",
  };
  room.pot = 0;
  room.status = "HAND_END";
  room.actionSeat = undefined;
  room.deadlineAt = undefined;
}
function settle(room: Room) {
  const awards = new Map<
    string,
    { playerId: string; amount: number; handName: string }
  >();
  const refunds = new Map<string, { playerId: string; amount: number }>();
  const levels = [
    ...new Set(room.players.map((p) => p.totalContribution).filter(Boolean)),
  ].sort((a, b) => a - b);
  let previous = 0;
  for (const level of levels) {
    const contributors = room.players.filter(
      (p) => p.totalContribution >= level,
    );
    const amount = (level - previous) * contributors.length;
    const eligible = contributors.filter((p) => !p.folded);
    if (!eligible.length) {
      previous = level;
      continue;
    }
    if (contributors.length === 1) {
      const player = contributors[0];
      player.stack += amount;
      const old = refunds.get(player.id);
      refunds.set(player.id, {
        playerId: player.id,
        amount: (old?.amount ?? 0) + amount,
      });
      previous = level;
      continue;
    }
    const scored = eligible.map((p) => ({
      p,
      s: evaluate([...p.holeCards, ...room.board]),
    }));
    const best = scored.map((x) => x.s).sort((a, b) => compareScore(b, a))[0];
    const winners = scored
      .filter((x) => compareScore(x.s, best) === 0)
      .map((x) => x.p)
      .sort((a, b) => a.seat - b.seat);
    const share = Math.floor(amount / winners.length);
    let rem = amount % winners.length;
    winners.forEach((w) => {
      const paid = share + (rem-- > 0 ? 1 : 0);
      w.stack += paid;
      w.lastAction = `승리 · ${best.name}`;
      const old = awards.get(w.id);
      awards.set(w.id, {
        playerId: w.id,
        amount: (old?.amount ?? 0) + paid,
        handName: best.name,
      });
    });
    previous = level;
  }
  room.result = {
    winners: [...awards.values()],
    refunds: [...refunds.values()],
    reason: "showdown",
  };
  room.pot = 0;
  room.status = "HAND_END";
  room.actionSeat = undefined;
  room.deadlineAt = undefined;
}
export function setFoldReveal(room: Room, playerId: string, reveal: boolean) {
  if (room.status !== "HAND_END" || room.result?.reason !== "fold")
    throw new Error("패 공개를 선택할 수 없는 상태입니다.");
  if (room.result.winners[0]?.playerId !== playerId)
    throw new Error("승자만 패 공개를 선택할 수 있습니다.");
  if (room.result.revealDecision)
    throw new Error("이미 패 공개 여부를 선택했습니다.");
  room.result.revealDecision = reveal ? "shown" : "hidden";
  const winner = room.players.find((player) => player.id === playerId);
  if (winner)
    winner.lastAction = reveal ? "승리 · 패 공개" : "승리 · 패 비공개";
  room.version++;
}
export function continueAfterHand(room: Room, reset: boolean) {
  if (room.status !== "HAND_END") throw new Error("종료된 핸드가 아닙니다.");
  if (room.result?.reason === "fold" && !room.result.revealDecision) {
    const winner = room.players.find(
      (player) => player.id === room.result?.winners[0]?.playerId,
    );
    if (winner?.connected)
      throw new Error("승자가 패 공개 여부를 선택할 때까지 기다려 주세요.");
    room.result.revealDecision = "hidden";
  }
  room.players = room.players.filter((p) => p.connected);
  if (reset) {
    room.players.forEach((p) => (p.stack = 100));
  } else {
    room.players = room.players.filter((p) => p.stack > 0);
  }
  if (!room.players.some((p) => p.id === room.hostId) && room.players.length)
    room.hostId = room.players.sort((a, b) => a.seat - b.seat)[0].id;
  room.status = "WAITING";
  room.version++;
  room.board = [];
  room.deck = [];
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = 2;
  room.actionSeat = undefined;
  room.deadlineAt = undefined;
  room.result = undefined;
  room.players.forEach((p) => {
    p.ready = false;
    p.folded = false;
    p.allIn = false;
    p.streetBet = 0;
    p.totalContribution = 0;
    p.holeCards = [];
    p.acted = false;
    p.lastAction = undefined;
  });
}
function reveal(room: Room, count: number) {
  for (let i = 0; i < count; i++) room.board.push(room.deck.pop()!);
}
function nextStreet(room: Room) {
  room.players.forEach((p) => {
    p.streetBet = 0;
    p.acted = false;
    p.lastAction = undefined;
  });
  room.currentBet = 0;
  room.minRaise = 2;
  if (room.status === "PREFLOP") {
    room.status = "FLOP";
    reveal(room, 3);
  } else if (room.status === "FLOP") {
    room.status = "TURN";
    reveal(room, 1);
  } else if (room.status === "TURN") {
    room.status = "RIVER";
    reveal(room, 1);
  } else if (room.status === "RIVER") {
    room.status = "SHOWDOWN";
    settle(room);
    return;
  }
  const a = room.players.filter(active);
  if (a.length <= 1) {
    room.actionSeat = undefined;
    room.deadlineAt = undefined;
    return;
  }
  room.actionSeat = nextSeat(room, room.dealerSeat, active);
  room.deadlineAt = Date.now() + 60_000;
}
export function advanceAllInRunout(room: Room) {
  if (
    room.actionSeat !== undefined ||
    room.status === "WAITING" ||
    room.status === "HAND_END" ||
    contenders(room).length < 2 ||
    room.players.filter(active).length > 1
  )
    return false;
  nextStreet(room);
  room.version++;
  return true;
}
export function applyAction(
  room: Room,
  playerId: string,
  action: ActionKind,
  commandId: string,
  expectedVersion: number,
  raiseTo?: number,
) {
  if (room.processed.has(commandId)) return;
  if (expectedVersion !== room.version)
    throw new Error("오래된 게임 상태입니다.");
  const p = room.players.find((x) => x.id === playerId);
  if (!p || p.seat !== room.actionSeat || !active(p))
    throw new Error("현재 행동할 수 없습니다.");
  const toCall = Math.max(0, room.currentBet - p.streetBet);
  let target = p.streetBet;
  if (action === "fold") {
    if (toCall === 0 && !commandId.startsWith("timeout:"))
      throw new Error("베팅이 없을 때는 폴드 대신 체크해 주세요.");
    p.folded = true;
    p.lastAction = "폴드";
  } else if (action === "check") {
    if (toCall) throw new Error("체크할 수 없습니다.");
    p.lastAction = "체크";
  } else if (action === "call") {
    commit(p, toCall);
    p.lastAction = p.allIn ? "올인 콜" : `콜 ${toCall}`;
  } else if (action === "allin") {
    target = p.streetBet + p.stack;
    const prior = room.currentBet;
    if (target > prior && p.acted)
      throw new Error(
        "짧은 올인 뒤에는 레이즈 권리가 다시 열리지 않습니다. 콜 또는 폴드를 선택해 주세요.",
      );
    commit(p, p.stack);
    if (target > prior) {
      const raise = target - prior;
      if (raise >= room.minRaise) {
        room.minRaise = raise;
        room.players
          .filter((x) => x.id !== p.id && active(x))
          .forEach((x) => (x.acted = false));
      }
      room.currentBet = target;
    }
    p.lastAction = "올인";
  } else if (action === "raise") {
    const maximum = p.streetBet + p.stack;
    const minimum = room.currentBet + room.minRaise;
    if (!Number.isSafeInteger(raiseTo))
      throw new Error("레이즈 금액이 올바르지 않습니다.");
    if (p.acted)
      throw new Error(
        "짧은 올인 뒤에는 레이즈 권리가 다시 열리지 않습니다. 콜 또는 폴드를 선택해 주세요.",
      );
    target = raiseTo!;
    if (maximum < minimum)
      throw new Error("최소 레이즈 칩이 부족합니다. 올인을 이용해 주세요.");
    if (target < minimum)
      throw new Error(
        `최소 레이즈 금액은 ${minimum}입니다. 직전 정상 레이즈 폭 이상 올려야 합니다.`,
      );
    if (target > maximum) throw new Error("보유 칩보다 많이 레이즈할 수 없습니다.");
    const raise = target - room.currentBet;
    commit(p, target - p.streetBet);
    room.minRaise = raise;
    room.players
      .filter((x) => x.id !== p.id && active(x))
      .forEach((x) => (x.acted = false));
    room.currentBet = target;
    p.lastAction = `레이즈 ${target}`;
  } else {
    throw new Error("지원하지 않는 액션입니다.");
  }
  p.acted = true;
  room.processed.add(commandId);
  room.version++;
  room.pot = room.players.reduce((s, x) => s + x.totalContribution, 0);
  if (contenders(room).length === 1) {
    awardUncontested(room);
    return;
  }
  if (bettingComplete(room)) {
    if (room.players.filter(active).length <= 1) {
      room.actionSeat = undefined;
      room.deadlineAt = undefined;
      return;
    }
    nextStreet(room);
    return;
  }
  room.actionSeat = nextSeat(room, p.seat, active);
  room.deadlineAt = Date.now() + 60_000;
}
export function forceFold(room: Room, playerId: string) {
  if (room.status === "WAITING" || room.status === "HAND_END") return false;
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player || player.folded) return false;
  player.folded = true;
  player.acted = true;
  player.lastAction = "게임 나감 · 폴드";
  room.version++;
  room.pot = room.players.reduce(
    (sum, candidate) => sum + candidate.totalContribution,
    0,
  );
  if (contenders(room).length === 1) {
    awardUncontested(room);
    return true;
  }
  if (bettingComplete(room)) {
    if (room.players.filter(active).length <= 1) {
      room.actionSeat = undefined;
      room.deadlineAt = undefined;
    } else nextStreet(room);
    return true;
  }
  if (room.actionSeat === player.seat) {
    room.actionSeat = nextSeat(room, player.seat, active);
    room.deadlineAt = Date.now() + 60_000;
  }
  return true;
}
export function expireTurn(room: Room, now = Date.now()) {
  if (
    !room.actionSeat ||
    !room.deadlineAt ||
    room.deadlineAt > now ||
    room.status === "WAITING" ||
    room.status === "HAND_END"
  )
    return false;
  const player = room.players.find((p) => p.seat === room.actionSeat);
  if (!player) return false;
  applyAction(
    room,
    player.id,
    "fold",
    `timeout:${room.handId}:${room.version}`,
    room.version,
  );
  player.lastAction = "시간 초과 폴드";
  return true;
}
export function viewFor(room: Room, me: Player): GameView {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    status: room.status,
    version: room.version,
    handId: room.handId,
    dealerSeat: room.dealerSeat,
    sbSeat: room.sbSeat,
    bbSeat: room.bbSeat,
    actionSeat: room.actionSeat,
    board: room.board,
    pot: room.pot,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    deadlineAt: room.deadlineAt,
    players: room.players.map((p) => ({
      ...p,
      holeCards: undefined,
      sessionId: undefined,
      raiseAllowed: !p.acted,
      acted: undefined,
      cardsVisible:
        room.status === "HAND_END" &&
        !p.folded &&
        (room.result?.reason === "showdown" ||
          (room.result?.reason === "fold" &&
            room.result.revealDecision === "shown" &&
            room.result.winners[0]?.playerId === p.id))
          ? p.holeCards
          : undefined,
    })),
    myPlayerId: me.id,
    myCards: me.holeCards,
    isSpectator: false,
    spectatorCount: 0,
    result: room.result,
  };
}
