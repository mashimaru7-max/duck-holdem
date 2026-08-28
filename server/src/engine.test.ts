import { describe, expect, it } from "vitest";
import { compareScore, createDeck, evaluate } from "./cards.js";
import {
  advanceAllInRunout,
  applyAction,
  continueAfterHand,
  expireTurn,
  forceFold,
  newPlayer,
  newRoom,
  setFoldReveal,
  startHand,
  viewFor,
} from "./engine.js";
describe("cards", () => {
  it("52장 덱이 모두 유일하다", () => {
    const d = createDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });
  it("족보와 A2345를 판정한다", () => {
    expect(evaluate(["AS", "KS", "QS", "JS", "TS"]).name).toBe(
      "스트레이트 플러시",
    );
    expect(evaluate(["AS", "2D", "3H", "4C", "5S"]).values[0]).toBe(5);
    expect(
      compareScore(
        evaluate(["AS", "AD", "KH", "QC", "2S"]),
        evaluate(["KS", "KD", "QH", "JC", "2D"]),
      ),
    ).toBeGreaterThan(0);
  });
  it("스트레이트는 가장 높은 카드가 큰 패가 이긴다", () => {
    const tenHigh = evaluate(["TS", "9D", "8H", "7C", "6S", "2D", "3C"]);
    const nineHigh = evaluate(["9S", "8D", "7H", "6C", "5S", "AD", "2C"]);
    const wheel = evaluate(["AS", "2D", "3H", "4C", "5S", "KD", "QC"]);
    expect(tenHigh.name).toBe("스트레이트");
    expect(tenHigh.values[0]).toBe(10);
    expect(compareScore(tenHigh, nineHigh)).toBeGreaterThan(0);
    expect(compareScore(nineHigh, wheel)).toBeGreaterThan(0);
  });
  it("홀덤 족보 순서를 낮은 패부터 높은 패까지 비교한다", () => {
    const hands = [
      evaluate(["AS", "KD", "9H", "7C", "3S"]),
      evaluate(["AS", "AD", "9H", "7C", "3S"]),
      evaluate(["AS", "AD", "9H", "9C", "3S"]),
      evaluate(["AS", "AD", "AH", "7C", "3S"]),
      evaluate(["9S", "8D", "7H", "6C", "5S"]),
      evaluate(["AS", "JS", "8S", "5S", "2S"]),
      evaluate(["AS", "AD", "AH", "7C", "7S"]),
      evaluate(["AS", "AD", "AH", "AC", "3S"]),
      evaluate(["9S", "8S", "7S", "6S", "5S"]),
    ];
    for (let index = 1; index < hands.length; index++) {
      expect(compareScore(hands[index], hands[index - 1])).toBeGreaterThan(0);
    }
  });
});
describe("engine", () => {
  it("준비 단계 없이 방장이 게임을 시작하고 중복 명령을 처리한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.5);
    expect(r.sbSeat).toBe(r.dealerSeat);
    expect(r.deadlineAt! - Date.now()).toBeGreaterThan(59_000);
    const actor = r.players.find((p) => p.seat === r.actionSeat)!;
    const v = r.version;
    applyAction(r, actor.id, "call", "same", v);
    const after = r.version;
    applyAction(r, actor.id, "call", "same", v);
    expect(r.version).toBe(after);
  });
  it("선택한 금액으로 레이즈하고 칩과 최소 레이즈를 갱신한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.35);
    const actor = r.players.find((player) => player.seat === r.actionSeat)!;
    const chipsBefore = r.players.reduce(
      (sum, player) => sum + player.stack + player.totalContribution,
      0,
    );
    applyAction(r, actor.id, "raise", "custom-raise", r.version, 7);
    expect(actor.streetBet).toBe(7);
    expect(actor.lastAction).toBe("레이즈 7");
    expect(r.currentBet).toBe(7);
    expect(r.minRaise).toBe(5);
    expect(
      r.players.reduce(
        (sum, player) => sum + player.stack + player.totalContribution,
        0,
      ),
    ).toBe(chipsBefore);
  });
  it("최소 금액 미만 또는 보유 칩 초과 레이즈를 거부한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.35);
    const actor = r.players.find((player) => player.seat === r.actionSeat)!;
    const minimum = r.currentBet + r.minRaise;
    const maximum = actor.streetBet + actor.stack;
    expect(() =>
      applyAction(r, actor.id, "raise", "raise-low", r.version, minimum - 1),
    ).toThrow("최소 레이즈 금액");
    expect(() =>
      applyAction(r, actor.id, "raise", "raise-high", r.version, maximum + 1),
    ).toThrow("보유 칩보다 많이");
    expect(actor.lastAction).toBeUndefined();
  });
  it("최소 폭보다 작은 올인은 허용하지만 레이즈 권리를 다시 열지 않는다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      c = newPlayer("C", "c", 3),
      r = newRoom(a, "1234");
    r.players.push(b, c);
    startHand(r, () => 0.35);
    const actor = r.players.find((player) => player.seat === r.actionSeat)!;
    const alreadyActed = r.players.find(
      (player) => player.id !== actor.id && !player.folded && !player.allIn,
    )!;
    alreadyActed.acted = true;
    const previousMinimumRaise = r.minRaise;
    const shortAllInTarget = r.currentBet + r.minRaise - 1;
    actor.stack = shortAllInTarget - actor.streetBet;
    applyAction(r, actor.id, "allin", "short-allin", r.version);
    expect(r.currentBet).toBe(shortAllInTarget);
    expect(r.minRaise).toBe(previousMinimumRaise);
    expect(alreadyActed.acted).toBe(true);
    r.actionSeat = alreadyActed.seat;
    expect(() =>
      applyAction(
        r,
        alreadyActed.id,
        "raise",
        "closed-raise",
        r.version,
        r.currentBet + r.minRaise,
      ),
    ).toThrow("레이즈 권리가 다시 열리지 않습니다");
    expect(() =>
      applyAction(r, alreadyActed.id, "allin", "closed-allin", r.version),
    ).toThrow("레이즈 권리가 다시 열리지 않습니다");
  });
  it("모두 올인하면 플랍, 턴, 리버, 결과를 단계별로 진행한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    a.ready = b.ready = true;
    startHand(r, () => 0.3);
    let actor = r.players.find((p) => p.seat === r.actionSeat)!;
    applyAction(r, actor.id, "allin", "a", r.version);
    actor = r.players.find((p) => p.seat === r.actionSeat)!;
    applyAction(r, actor.id, "call", "b", r.version);
    expect(r.players.reduce((sum, player) => sum + player.stack + player.totalContribution, 0)).toBe(200);
    expect(r.status).toBe("PREFLOP");
    expect(r.board).toHaveLength(0);
    expect(r.actionSeat).toBeUndefined();
    const runoutView = viewFor(r, actor);
    expect(runoutView.players.every((player) => player.cardsVisible?.length === 2)).toBe(true);
    expect(advanceAllInRunout(r)).toBe(true);
    expect(r.status).toBe("FLOP");
    expect(r.board).toHaveLength(3);
    advanceAllInRunout(r);
    expect(r.status).toBe("TURN");
    expect(r.board).toHaveLength(4);
    advanceAllInRunout(r);
    expect(r.status).toBe("RIVER");
    expect(r.board).toHaveLength(5);
    advanceAllInRunout(r);
    expect(r.status).toBe("HAND_END");
    expect(r.result?.reason).toBe("showdown");
    expect(r.pot).toBe(0);
    expect(r.players.reduce((sum, player) => sum + player.stack, 0)).toBe(200);
  });
  it("초과 올인 금액은 승리가 아닌 미사용 베팅 반환으로 처리한다", () => {
    const short = newPlayer("Short", "short", 1),
      deep = newPlayer("Deep", "deep", 2),
      r = newRoom(short, "1234");
    short.stack = 20;
    deep.stack = 100;
    r.players.push(deep);
    startHand(r, () => 0.3);
    let actor = r.players.find((player) => player.seat === r.actionSeat)!;
    applyAction(r, actor.id, "allin", "deep-allin", r.version);
    actor = r.players.find((player) => player.seat === r.actionSeat)!;
    applyAction(r, actor.id, "call", "short-call", r.version);
    short.holeCards = ["AS", "AD"];
    deep.holeCards = ["KS", "KD"];
    r.deck = ["JC", "9S", "7H", "3D", "2C"];
    while (r.status !== "HAND_END") advanceAllInRunout(r);
    expect(r.result?.winners).toEqual([
      { playerId: short.id, amount: 40, handName: "원페어" },
    ]);
    expect(r.result?.refunds).toEqual([{ playerId: deep.id, amount: 80 }]);
    expect(r.players.reduce((sum, player) => sum + player.stack, 0)).toBe(120);
  });
  it("콜할 금액이 없으면 폴드할 수 없고 체크해야 한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.6);
    r.currentBet = 0;
    const actor = r.players.find((player) => player.seat === r.actionSeat)!;
    actor.streetBet = 0;
    expect(() => applyAction(r, actor.id, "fold", "fold", r.version)).toThrow(
      "폴드 대신 체크",
    );
    applyAction(r, actor.id, "check", "check", r.version);
    expect(actor.lastAction).toBe("체크");
  });
  it("제한 시간이 지나면 서버가 자동 폴드한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    a.ready = b.ready = true;
    startHand(r, () => 0.4);
    const actor = r.players.find((p) => p.seat === r.actionSeat)!;
    expect(expireTurn(r, r.deadlineAt! - 1)).toBe(false);
    expect(expireTurn(r, r.deadlineAt!)).toBe(true);
    expect(actor.folded).toBe(true);
    expect(actor.lastAction).toBe("시간 초과 폴드");
    expect(r.status).toBe("HAND_END");
  });
  it("게임 중 나가면 즉시 폴드하고 남은 한 명이 승리한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.4);
    const leaving = r.players.find((player) => player.seat === r.actionSeat)!;
    expect(forceFold(r, leaving.id)).toBe(true);
    expect(leaving.folded).toBe(true);
    expect(r.status).toBe("HAND_END");
    expect(r.result?.reason).toBe("fold");
    expect(r.result?.winners[0].playerId).not.toBe(leaving.id);
  });
  it("게임 중 퇴장한 플레이어는 베팅 기록은 유지하되 화면에서 즉시 사라진다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      c = newPlayer("C", "c", 3),
      r = newRoom(a, "1234");
    r.players.push(b, c);
    startHand(r, () => 0.4);
    const leaving = r.players.find((player) => player.seat === r.actionSeat)!;
    const contribution = leaving.totalContribution;
    leaving.connected = false;
    expect(forceFold(r, leaving.id)).toBe(true);
    expect(r.players).toContain(leaving);
    expect(leaving.totalContribution).toBe(contribution);
    expect(viewFor(r, a).players.some((player) => player.id === leaving.id)).toBe(false);
  });
  it("콜할 금액이 없어도 제한 시간이 지나면 자동 폴드한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.45);
    const actor = r.players.find((player) => player.seat === r.actionSeat)!;
    r.currentBet = actor.streetBet;
    expect(expireTurn(r, r.deadlineAt!)).toBe(true);
    expect(actor.folded).toBe(true);
    expect(actor.lastAction).toBe("시간 초과 폴드");
  });
  it("전원 폴드 시 결과를 기록하고 새 게임으로 전환한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    a.ready = b.ready = true;
    startHand(r, () => 0.2);
    const actor = r.players.find((p) => p.seat === r.actionSeat)!;
    applyAction(r, actor.id, "fold", "f", r.version);
    expect(r.status).toBe("HAND_END");
    expect(r.result?.winners).toHaveLength(1);
    const winner = r.players.find((player) => player.id === r.result?.winners[0].playerId)!;
    expect(viewFor(r, actor).players.find((player) => player.id === winner.id)?.cardsVisible).toBeUndefined();
    setFoldReveal(r, winner.id, true);
    expect(viewFor(r, actor).players.find((player) => player.id === winner.id)?.cardsVisible).toEqual(winner.holeCards);
    expect(r.players.reduce((s, p) => s + p.stack, 0)).toBe(200);
    continueAfterHand(r, true);
    expect(r.status).toBe("WAITING");
    expect(r.players.every((p) => p.stack === 100 && !p.ready)).toBe(true);
  });
  it("승자가 패 공개를 선택하지 않아도 다음 판으로 진행한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.2);
    const actor = r.players.find((player) => player.seat === r.actionSeat)!;
    applyAction(r, actor.id, "fold", "fold-without-choice", r.version);
    expect(r.result?.revealDecision).toBeUndefined();
    continueAfterHand(r, false);
    expect(r.status).toBe("WAITING");
  });
  it("진행 중인 내 족보를 프리플랍부터 표시한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      r = newRoom(a, "1234");
    r.players.push(b);
    startHand(r, () => 0.4);
    a.holeCards = ["AS", "AH"];
    expect(viewFor(r, a).myHandName).toBe("원페어");
    r.board = ["2C", "3D", "4H"];
    expect(viewFor(r, a).myHandName).toBe("원페어");
  });
  it("탈락자는 다음 토너먼트 판에 카드를 받지 않고 관전한다", () => {
    const a = newPlayer("A", "a", 1),
      b = newPlayer("B", "b", 2),
      eliminated = newPlayer("C", "c", 3),
      r = newRoom(a, "1234");
    r.players.push(b, eliminated);
    r.status = "HAND_END";
    r.result = { winners: [], reason: "showdown" };
    eliminated.stack = 0;
    continueAfterHand(r, false);
    expect(r.players).toContain(eliminated);
    startHand(r, () => 0.4);
    expect(eliminated.holeCards).toEqual([]);
    expect(eliminated.folded).toBe(true);
    expect(viewFor(r, eliminated).players.find((player) => player.id === eliminated.id)?.eliminated).toBe(true);
  });
  it("칩을 가진 마지막 한 명을 토너먼트 우승자로 표시한다", () => {
    const winner = newPlayer("Winner", "winner", 1),
      loser = newPlayer("Loser", "loser", 2),
      r = newRoom(winner, "1234");
    r.players.push(loser);
    r.status = "HAND_END";
    r.result = { winners: [{ playerId: winner.id, amount: 200, handName: "승리" }], reason: "showdown" };
    winner.stack = 200;
    loser.stack = 0;
    expect(viewFor(r, winner).tournamentWinnerId).toBe(winner.id);
  });
});
