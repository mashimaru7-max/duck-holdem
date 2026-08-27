import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {randomUUID} from 'node:crypto';
import type {ClientMessage,GameView,RoomSummary,ServerMessage} from '@duck-holdem/shared';
import {advanceAllInRunout,applyAction,continueAfterHand,expireTurn,forceFold,newPlayer,newRoom,setFoldReveal,startHand,viewFor,type Player,type Room} from './engine.js';

interface Spectator{id:string;sessionId:string;nickname:string;connected:boolean}
type Current={room:Room;member:Player|Spectator;role:'player'|'spectator'};

const app=Fastify({logger:true});
await app.register(cors,{origin:true});
await app.register(websocket);

const rooms=new Map<string,Room>();
const spectators=new Map<string,Spectator[]>();
const sockets=new Map<string,Set<any>>();
const sessions=new Map<string,Current>();
const clients=new Set<any>();
const runoutTimers=new Map<string,NodeJS.Timeout>();
const send=(ws:any,msg:ServerMessage)=>ws.readyState===1&&ws.send(JSON.stringify(msg));
const watchers=(room:Room)=>spectators.get(room.code)??[];

function roomList():RoomSummary[]{
  return [...rooms.values()].map(room=>({roomCode:room.code,hostNickname:room.players.find(player=>player.id===room.hostId)?.nickname??'방장 오리',playerCount:room.players.length,spectatorCount:watchers(room).length,capacity:8,status:room.status}));
}
function broadcastLobby(){const message:ServerMessage={type:'room_list',rooms:roomList()};for(const ws of clients)send(ws,message);}
function scheduleRunout(room:Room){
  if(runoutTimers.has(room.code)||room.actionSeat!==undefined||room.status==='WAITING'||room.status==='HAND_END')return;
  const timer=setTimeout(()=>{runoutTimers.delete(room.code);if(rooms.get(room.code)===room&&advanceAllInRunout(room))broadcast(room);},1_100);runoutTimers.set(room.code,timer);
}
function spectatorView(room:Room,spectator:Spectator):GameView{
  const base=viewFor(room,room.players[0]);return{...base,myPlayerId:spectator.id,myCards:[],isSpectator:true,spectatorCount:watchers(room).length};
}
function broadcast(room:Room){
  const spectatorCount=watchers(room).length;
  for(const player of room.players)for(const ws of sockets.get(player.id)??[])send(ws,{type:'state',state:{...viewFor(room,player),spectatorCount}});
  for(const spectator of watchers(room))for(const ws of sockets.get(spectator.id)??[])send(ws,{type:'state',state:spectatorView(room,spectator)});
  broadcastLobby();scheduleRunout(room);
}
function code(){let value='';do{value=String(Math.floor(1000+Math.random()*9000));}while(rooms.has(value));return value;}
function nickname(value:string){const trimmed=value.trim().slice(0,12);if(!trimmed)throw new Error('닉네임을 입력해 주세요.');return trimmed;}
function deleteRoom(room:Room){
  const timer=runoutTimers.get(room.code);if(timer)clearTimeout(timer);runoutTimers.delete(room.code);
  for(const spectator of watchers(room))for(const ws of sockets.get(spectator.id)??[])send(ws,{type:'kicked',message:'플레이어가 모두 나가 방이 종료되었습니다.'});
  for(const member of [...room.players,...watchers(room)]){sessions.delete(member.sessionId);sockets.delete(member.id);}
  spectators.delete(room.code);rooms.delete(room.code);broadcastLobby();
}
function removePlayer(room:Room,player:Player){
  room.players=room.players.filter(candidate=>candidate.id!==player.id);sockets.delete(player.id);sessions.delete(player.sessionId);
  if(room.players.length===0||room.players.every(candidate=>!candidate.connected)){deleteRoom(room);return;}
  if(room.hostId===player.id)room.hostId=[...room.players].sort((a,b)=>a.seat-b.seat)[0].id;
  room.version++;broadcast(room);
}
function removeSpectator(room:Room,spectator:Spectator){
  spectators.set(room.code,watchers(room).filter(candidate=>candidate.id!==spectator.id));sockets.delete(spectator.id);sessions.delete(spectator.sessionId);broadcast(room);
}
function attachSocket(socket:any,current:Current){
  if(!sockets.has(current.member.id))sockets.set(current.member.id,new Set());sockets.get(current.member.id)!.add(socket);
  send(socket,{type:'welcome',playerId:current.member.id,sessionId:current.member.sessionId});broadcast(current.room);
}

app.get('/health',async()=>({ok:true,rooms:rooms.size}));
app.get('/ws',{websocket:true},socket=>{
  let current:Current|undefined;
  (socket as any).isAlive=true;socket.on('pong',()=>{(socket as any).isAlive=true;});
  clients.add(socket);send(socket,{type:'room_list',rooms:roomList()});
  socket.on('message',(raw:Buffer)=>{
    let msg:ClientMessage;
    try{msg=JSON.parse(raw.toString());}catch{return send(socket,{type:'error',code:'BAD_JSON',message:'잘못된 요청입니다.'});}
    try{
      if(msg.type==='create_room'){
        const playerNickname=nickname(msg.nickname);const player=newPlayer(playerNickname,msg.sessionId||randomUUID(),1);const room=newRoom(player,code());rooms.set(room.code,room);spectators.set(room.code,[]);current={room,member:player,role:'player'};sessions.set(player.sessionId,current);
      }else if(msg.type==='join_room'){
        const room=rooms.get(msg.roomCode);if(!room||(room.status!=='WAITING'&&room.status!=='HAND_END')||room.players.length>=8)throw new Error('참가할 수 없는 방입니다.');const playerNickname=nickname(msg.nickname);
        const seat=Array.from({length:8},(_,index)=>index+1).find(value=>!room.players.some(player=>player.seat===value))!;const player=newPlayer(playerNickname,msg.sessionId,seat);room.players.push(player);current={room,member:player,role:'player'};sessions.set(player.sessionId,current);room.version++;
      }else if(msg.type==='spectate_room'){
        const room=rooms.get(msg.roomCode);if(!room||room.status==='WAITING')throw new Error('관전할 수 없는 방입니다.');const spectatorNickname=nickname(msg.nickname);const spectator:Spectator={id:randomUUID(),sessionId:msg.sessionId,nickname:spectatorNickname,connected:true};spectators.set(room.code,[...watchers(room),spectator]);current={room,member:spectator,role:'spectator'};sessions.set(spectator.sessionId,current);
      }else{
        if(!current)throw new Error('먼저 방에 참가하세요.');const {room,member}=current;
        if(msg.type==='leave'){
          if(current.role==='spectator')removeSpectator(room,member as Spectator);else{const player=member as Player;if(room.status==='WAITING'||room.status==='HAND_END')removePlayer(room,player);else{player.connected=false;forceFold(room,player.id);sockets.get(player.id)?.delete(socket);sockets.delete(player.id);sessions.delete(player.sessionId);if(room.hostId===player.id)room.hostId=room.players.filter(candidate=>candidate.connected).sort((a,b)=>a.seat-b.seat)[0]?.id??room.hostId;broadcast(room);}}current=undefined;send(socket,{type:'room_list',rooms:roomList()});return;
        }
        if(current.role==='spectator'){
          if(msg.type!=='join_game')throw new Error('관전 중에는 게임 액션을 할 수 없습니다.');if((room.status!=='WAITING'&&room.status!=='HAND_END')||room.players.length>=8)throw new Error('현재 게임에 참여할 수 없습니다.');
          const spectator=member as Spectator;const seat=Array.from({length:8},(_,index)=>index+1).find(value=>!room.players.some(player=>player.seat===value))!;const player=newPlayer(spectator.nickname,spectator.sessionId,seat);player.id=spectator.id;spectators.set(room.code,watchers(room).filter(candidate=>candidate.id!==spectator.id));room.players.push(player);current={room,member:player,role:'player'};sessions.set(player.sessionId,current);room.version++;
        }else{
          const player=member as Player;if(!room.players.some(candidate=>candidate.id===player.id)){current=undefined;throw new Error('더 이상 이 방에 참가하고 있지 않습니다.');}
          if(msg.type==='ready'){player.ready=msg.ready;room.version++;}
          else if(msg.type==='start'){if(room.hostId!==player.id)throw new Error('방장만 시작할 수 있습니다.');startHand(room);}
          else if(msg.type==='continue'){if(room.hostId!==player.id)throw new Error('방장만 다음 게임을 준비할 수 있습니다.');continueAfterHand(room,msg.reset);}
          else if(msg.type==='reveal_cards'){setFoldReveal(room,player.id,msg.reveal);}
          else if(msg.type==='kick'){if(room.hostId!==player.id)throw new Error('방장만 강퇴할 수 있습니다.');if(room.status!=='WAITING')throw new Error('대기방에서만 강퇴할 수 있습니다.');if(msg.playerId===player.id)throw new Error('자신은 강퇴할 수 없습니다.');const target=room.players.find(candidate=>candidate.id===msg.playerId);if(!target)throw new Error('플레이어를 찾을 수 없습니다.');for(const ws of sockets.get(target.id)??[])send(ws,{type:'kicked',message:'방장에 의해 방에서 나왔습니다.'});removePlayer(room,target);}
          else if(msg.type==='join_game')throw new Error('이미 게임에 참가하고 있습니다.');
          else applyAction(room,player.id,msg.action,msg.commandId,msg.expectedVersion,msg.raiseTo);
        }
      }
      if(current)attachSocket(socket,current);
    }catch(error){send(socket,{type:'error',commandId:msg.commandId,code:'INVALID_COMMAND',message:error instanceof Error?error.message:'요청 실패'});}
  });
  socket.on('close',()=>{
    clients.delete(socket);if(!current)return;const {room,member,role}=current;const memberSockets=sockets.get(member.id);memberSockets?.delete(socket);if(memberSockets?.size)return;member.connected=false;
    if(role==='spectator'){removeSpectator(room,member as Spectator);return;}
    const player=member as Player;if(room.status==='WAITING'||room.status==='HAND_END'){if(room.players.some(candidate=>candidate.id===player.id))removePlayer(room,player);}else if(room.players.every(candidate=>!candidate.connected))deleteRoom(room);else{forceFold(room,player.id);if(room.hostId===player.id)room.hostId=room.players.filter(candidate=>candidate.connected).sort((a,b)=>a.seat-b.seat)[0].id;broadcast(room);}
  });
});

setInterval(()=>{for(const room of rooms.values())if(expireTurn(room))broadcast(room);},500);
setInterval(()=>{for(const socket of clients){if((socket as any).isAlive===false){socket.terminate();continue;}(socket as any).isAlive=false;socket.ping();}},5_000);

const port=Number(process.env.PORT??8787);
await app.listen({port,host:'0.0.0.0'});
