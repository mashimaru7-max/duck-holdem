export type Suit = 'C'|'D'|'H'|'S';
export type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A';
export type Card = `${Rank}${Suit}`;
export type Street = 'WAITING'|'PREFLOP'|'FLOP'|'TURN'|'RIVER'|'SHOWDOWN'|'HAND_END';
export type ActionKind = 'fold'|'check'|'call'|'raise'|'allin';

export interface PublicPlayer {
  id:string; nickname:string; seat:number; stack:number; ready:boolean; connected:boolean;
  folded:boolean; allIn:boolean; streetBet:number; totalContribution:number; lastAction?:string;
  cardsVisible?:Card[]; raiseAllowed?:boolean; eliminated?:boolean;
}
export interface GameView {
  roomCode:string; hostId:string; status:Street; version:number; handId?:string;
  dealerSeat?:number; sbSeat?:number; bbSeat?:number; actionSeat?:number;
  board:Card[]; pot:number; currentBet:number; minRaise:number; deadlineAt?:number; nextHandAt?:number;
  players:PublicPlayer[]; myPlayerId:string; myCards:Card[]; isSpectator:boolean; spectatorCount:number;
  myHandName?:string; tournamentWinnerId?:string;
  result?:{winners:{playerId:string;amount:number;handName:string}[];refunds?:{playerId:string;amount:number}[];reason:'showdown'|'fold';revealDecision?:'shown'|'hidden'};
}
export interface RoomSummary {
  roomCode:string; hostNickname:string; playerCount:number; spectatorCount:number; capacity:number; status:Street;
}
export type ClientMessage =
  | {type:'create_room'; commandId:string; nickname:string; sessionId:string}
  | {type:'join_room'; commandId:string; nickname:string; roomCode:string; sessionId:string}
  | {type:'spectate_room'; commandId:string; nickname:string; roomCode:string; sessionId:string}
  | {type:'join_game'; commandId:string}
  | {type:'reveal_cards'; commandId:string; reveal:boolean}
  | {type:'ready'; commandId:string; ready:boolean}
  | {type:'start'; commandId:string}
  | {type:'continue'; commandId:string; reset:boolean}
  | {type:'kick'; commandId:string; playerId:string}
  | {type:'leave'; commandId:string}
  | {type:'action'; commandId:string; expectedVersion:number; action:ActionKind; raiseTo?:number};
export type ServerMessage =
  | {type:'welcome'; playerId:string; sessionId:string}
  | {type:'room_list'; rooms:RoomSummary[]}
  | {type:'kicked'; message:string}
  | {type:'state'; state:GameView}
  | {type:'error'; commandId?:string; code:string; message:string};
