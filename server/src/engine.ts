import {randomUUID} from 'node:crypto';
import type {ActionKind, Card, GameView, PublicPlayer, Street} from '@duck-holdem/shared';
import {createDeck,evaluate,compareScore,shuffle} from './cards.js';

export interface Player extends PublicPlayer {sessionId:string; holeCards:Card[]; acted:boolean}
export interface Room {code:string;hostId:string;status:Street;version:number;players:Player[];deck:Card[];board:Card[];dealerSeat:number;sbSeat:number;bbSeat:number;actionSeat?:number;pot:number;currentBet:number;minRaise:number;handId?:string;deadlineAt?:number;processed:Set<string>;result?:{winners:{playerId:string;amount:number;handName:string}[];reason:'showdown'|'fold'}}
const nextSeat=(room:Room,from:number,predicate=(p:Player)=>true)=>{const seats=room.players.filter(predicate).map(p=>p.seat).sort((a,b)=>a-b); return seats.find(s=>s>from)??seats[0];};
export function newRoom(host:Player,code:string):Room{return{code,hostId:host.id,status:'WAITING',version:0,players:[host],deck:[],board:[],dealerSeat:host.seat,sbSeat:host.seat,bbSeat:host.seat,pot:0,currentBet:0,minRaise:2,processed:new Set()};}
export function newPlayer(nickname:string,sessionId:string,seat:number):Player{return{id:randomUUID(),sessionId,nickname,seat,stack:100,ready:false,connected:true,folded:false,allIn:false,streetBet:0,totalContribution:0,holeCards:[],acted:false};}
function commit(p:Player,amount:number){const paid=Math.min(p.stack,Math.max(0,amount));p.stack-=paid;p.streetBet+=paid;p.totalContribution+=paid;if(p.stack===0)p.allIn=true;return paid;}
function active(p:Player){return !p.folded&&!p.allIn;}
export function startHand(room:Room,random=Math.random){
  if(room.players.length<2||room.players.some(p=>!p.ready))throw new Error('2명 이상 전원 준비가 필요합니다.');
  room.handId=randomUUID(); room.status='PREFLOP'; room.version++; room.deck=shuffle(createDeck(),random);room.board=[];room.pot=0;room.currentBet=2;room.minRaise=2;room.result=undefined;
  room.players.forEach(p=>{p.folded=false;p.allIn=false;p.streetBet=0;p.totalContribution=0;p.holeCards=[room.deck.pop()!,room.deck.pop()!];p.acted=false;p.lastAction=undefined;});
  room.dealerSeat=nextSeat(room,room.dealerSeat); if(room.players.length===2){room.sbSeat=room.dealerSeat;room.bbSeat=nextSeat(room,room.sbSeat);}else{room.sbSeat=nextSeat(room,room.dealerSeat);room.bbSeat=nextSeat(room,room.sbSeat);}
  commit(room.players.find(p=>p.seat===room.sbSeat)!,1);commit(room.players.find(p=>p.seat===room.bbSeat)!,2);
  room.actionSeat=room.players.length===2?room.sbSeat:nextSeat(room,room.bbSeat,active);room.deadlineAt=Date.now()+60_000;
}
function contenders(room:Room){return room.players.filter(p=>!p.folded);}
function bettingComplete(room:Room){const a=room.players.filter(active);return a.length===0||a.every(p=>p.acted&&p.streetBet===room.currentBet);}
function awardUncontested(room:Room){const winner=contenders(room)[0];const amount=room.players.reduce((s,p)=>s+p.totalContribution,0);winner.stack+=amount;winner.lastAction='승리';room.result={winners:[{playerId:winner.id,amount,handName:'상대 전원 폴드'}],reason:'fold'};room.pot=0;room.status='HAND_END';room.actionSeat=undefined;room.deadlineAt=undefined;}
function settle(room:Room){
  const awards=new Map<string,{playerId:string;amount:number;handName:string}>();
  const levels=[...new Set(room.players.map(p=>p.totalContribution).filter(Boolean))].sort((a,b)=>a-b);let previous=0;
  for(const level of levels){const contributors=room.players.filter(p=>p.totalContribution>=level);const amount=(level-previous)*contributors.length;const eligible=contributors.filter(p=>!p.folded);if(!eligible.length){previous=level;continue;}
    const scored=eligible.map(p=>({p,s:evaluate([...p.holeCards,...room.board])}));const best=scored.map(x=>x.s).sort((a,b)=>compareScore(b,a))[0];const winners=scored.filter(x=>compareScore(x.s,best)===0).map(x=>x.p).sort((a,b)=>a.seat-b.seat);const share=Math.floor(amount/winners.length);let rem=amount%winners.length;winners.forEach(w=>{const paid=share+(rem-->0?1:0);w.stack+=paid;w.lastAction=`승리 · ${best.name}`;const old=awards.get(w.id);awards.set(w.id,{playerId:w.id,amount:(old?.amount??0)+paid,handName:best.name});});previous=level;
  } room.result={winners:[...awards.values()],reason:'showdown'};room.pot=0;room.status='HAND_END';room.actionSeat=undefined;room.deadlineAt=undefined;
}
export function continueAfterHand(room:Room,reset:boolean){if(room.status!=='HAND_END')throw new Error('종료된 핸드가 아닙니다.');if(reset){room.players.forEach(p=>p.stack=100);}else{room.players=room.players.filter(p=>p.stack>0);if(room.players.length<2)throw new Error('다음 판에 필요한 플레이어가 부족합니다.');}if(!room.players.some(p=>p.id===room.hostId))room.hostId=room.players.sort((a,b)=>a.seat-b.seat)[0].id;room.status='WAITING';room.version++;room.board=[];room.deck=[];room.pot=0;room.currentBet=0;room.minRaise=2;room.actionSeat=undefined;room.deadlineAt=undefined;room.result=undefined;room.players.forEach(p=>{p.ready=false;p.folded=false;p.allIn=false;p.streetBet=0;p.totalContribution=0;p.holeCards=[];p.acted=false;p.lastAction=undefined;});}
function reveal(room:Room,count:number){for(let i=0;i<count;i++)room.board.push(room.deck.pop()!);}
function nextStreet(room:Room){room.players.forEach(p=>{p.streetBet=0;p.acted=false;});room.currentBet=0;room.minRaise=2;
  if(room.status==='PREFLOP'){room.status='FLOP';reveal(room,3);}else if(room.status==='FLOP'){room.status='TURN';reveal(room,1);}else if(room.status==='TURN'){room.status='RIVER';reveal(room,1);}else if(room.status==='RIVER'){room.status='SHOWDOWN';settle(room);return;}
  const a=room.players.filter(active);if(a.length===0){while(room.board.length<5)reveal(room,1);settle(room);return;}room.actionSeat=nextSeat(room,room.dealerSeat,active);room.deadlineAt=Date.now()+60_000;
}
export function applyAction(room:Room,playerId:string,action:ActionKind,commandId:string,expectedVersion:number){
  if(room.processed.has(commandId))return;if(expectedVersion!==room.version)throw new Error('오래된 게임 상태입니다.');const p=room.players.find(x=>x.id===playerId);if(!p||p.seat!==room.actionSeat||!active(p))throw new Error('현재 행동할 수 없습니다.');
  const toCall=Math.max(0,room.currentBet-p.streetBet);let target=p.streetBet;
  if(action==='fold'){p.folded=true;p.lastAction='폴드';}
  else if(action==='check'){if(toCall)throw new Error('체크할 수 없습니다.');p.lastAction='체크';}
  else if(action==='call'){commit(p,toCall);p.lastAction=p.allIn?'올인 콜':`콜 ${toCall}`;}
  else if(action==='allin'){target=p.streetBet+p.stack;const prior=room.currentBet;commit(p,p.stack);if(target>prior){const raise=target-prior;if(raise>=room.minRaise){room.minRaise=raise;room.players.filter(x=>x.id!==p.id&&active(x)).forEach(x=>x.acted=false);}room.currentBet=target;}p.lastAction='올인';}
  else {const pot=room.players.reduce((s,x)=>s+x.totalContribution,0);const desired=action==='double'?Math.max(room.currentBet*2,room.currentBet+room.minRaise):Math.max(room.currentBet+room.minRaise,room.currentBet+Math.ceil(pot/2));target=Math.min(p.streetBet+p.stack,desired);const raise=target-room.currentBet;if(target<=room.currentBet)throw new Error('레이즈할 칩이 부족합니다.');commit(p,target-p.streetBet);if(raise>=room.minRaise){room.minRaise=raise;room.players.filter(x=>x.id!==p.id&&active(x)).forEach(x=>x.acted=false);}room.currentBet=Math.max(room.currentBet,target);p.lastAction=action==='double'?`따당 ${target}`:`하프 ${target}`;}
  p.acted=true;room.processed.add(commandId);room.version++;room.pot=room.players.reduce((s,x)=>s+x.totalContribution,0);
  if(contenders(room).length===1){awardUncontested(room);return;}if(bettingComplete(room)){nextStreet(room);return;}room.actionSeat=nextSeat(room,p.seat,active);room.deadlineAt=Date.now()+60_000;
}
export function expireTurn(room:Room,now=Date.now()){
  if(!room.actionSeat||!room.deadlineAt||room.deadlineAt>now||room.status==='WAITING'||room.status==='HAND_END')return false;
  const player=room.players.find(p=>p.seat===room.actionSeat);if(!player)return false;
  applyAction(room,player.id,'fold',`timeout:${room.handId}:${room.version}`,room.version);player.lastAction='시간 초과 폴드';return true;
}
export function viewFor(room:Room,me:Player):GameView{return{roomCode:room.code,hostId:room.hostId,status:room.status,version:room.version,handId:room.handId,dealerSeat:room.dealerSeat,sbSeat:room.sbSeat,bbSeat:room.bbSeat,actionSeat:room.actionSeat,board:room.board,pot:room.pot,currentBet:room.currentBet,minRaise:room.minRaise,deadlineAt:room.deadlineAt,players:room.players.map(p=>({...p,holeCards:undefined,sessionId:undefined,acted:undefined,cardsVisible:room.status==='HAND_END'&&!p.folded?p.holeCards:undefined})),myPlayerId:me.id,myCards:me.holeCards,result:room.result};}
