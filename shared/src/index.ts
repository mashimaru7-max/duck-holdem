export type Suit = 'C'|'D'|'H'|'S';
export type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A';
export type Card = `${Rank}${Suit}`;
export type Street = 'WAITING'|'PREFLOP'|'FLOP'|'TURN'|'RIVER'|'SHOWDOWN'|'HAND_END';
export type ActionKind = 'fold'|'check'|'call'|'double'|'half'|'allin';

export interface PublicPlayer {
  id:string; nickname:string; seat:number; stack:number; ready:boolean; connected:boolean;
  folded:boolean; allIn:boolean; streetBet:number; totalContribution:number; lastAction?:string;
  cardsVisible?:Card[];
}
export interface GameView {
  roomCode:string; hostId:string; status:Street; version:number; handId?:string;
  dealerSeat?:number; sbSeat?:number; bbSeat?:number; actionSeat?:number;
  board:Card[]; pot:number; currentBet:number; minRaise:number; deadlineAt?:number;
  players:PublicPlayer[]; myPlayerId:string; myCards:Card[];
}
export type ClientMessage =
  | {type:'create_room'; commandId:string; nickname:string; sessionId:string}
  | {type:'join_room'; commandId:string; nickname:string; roomCode:string; sessionId:string}
  | {type:'ready'; commandId:string; ready:boolean}
  | {type:'start'; commandId:string}
  | {type:'action'; commandId:string; expectedVersion:number; action:ActionKind};
export type ServerMessage =
  | {type:'welcome'; playerId:string; sessionId:string}
  | {type:'state'; state:GameView}
  | {type:'error'; commandId?:string; code:string; message:string};
