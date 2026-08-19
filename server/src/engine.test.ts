import { describe, expect, it } from "vitest";
import { compareScore, createDeck, evaluate } from "./cards.js";
import {
  advanceAllInRunout,
  applyAction,
  continueAfterHand,
  expireTurn,
  newPlayer,
  newRoom,
  startHand,
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
    expect(r.status).toBe("PREFLOP");
    expect(r.board).toHaveLength(0);
    expect(r.actionSeat).toBeUndefined();
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
    expect(r.players.reduce((s, p) => s + p.stack, 0)).toBe(200);
    continueAfterHand(r, true);
    expect(r.status).toBe("WAITING");
    expect(r.players.every((p) => p.stack === 100 && !p.ready)).toBe(true);
  });
});
