import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {randomUUID} from 'node:crypto';
import type {ClientMessage,RoomSummary,ServerMessage} from '@duck-holdem/shared';
import {advanceAllInRunout,applyAction,continueAfterHand,expireTurn,newPlayer,newRoom,startHand,viewFor,type Player,type Room} from './engine.js';

const app=Fastify({logger:true});
await app.register(cors,{origin:true});
await app.register(websocket);

const rooms=new Map<string,Room>();
const sockets=new Map<string,Set<any>>();
const sessions=new Map<string,{room:Room;player:Player}>();
const clients=new Set<any>();
const runoutTimers=new Map<string,NodeJS.Timeout>();
const send=(ws:any,msg:ServerMessage)=>ws.readyState===1&&ws.send(JSON.stringify(msg));

function roomList():RoomSummary[]{
  return [...rooms.values()].filter(room=>room.status==='WAITING'&&room.players.length<8).map(room=>({roomCode:room.code,hostNickname:room.players.find(player=>player.id===room.hostId)?.nickname??'방장 오리',playerCount:room.players.length,capacity:8,status:room.status}));
}
function broadcastLobby(){const message:ServerMessage={type:'room_list',rooms:roomList()};for(const ws of clients)send(ws,message);}
function scheduleRunout(room:Room){
  if(runoutTimers.has(room.code)||room.actionSeat!==undefined||room.status==='WAITING'||room.status==='HAND_END')return;
  const timer=setTimeout(()=>{runoutTimers.delete(room.code);if(rooms.get(room.code)===room&&advanceAllInRunout(room))broadcast(room);},1_100);runoutTimers.set(room.code,timer);
}
function broadcast(room:Room){for(const player of room.players)for(const ws of sockets.get(player.id)??[])send(ws,{type:'state',state:viewFor(room,player)});broadcastLobby();scheduleRunout(room);}
function code(){let value='';do{value=String(Math.floor(1000+Math.random()*9000));}while(rooms.has(value));return value;}
function nickname(value:string){const trimmed=value.trim().slice(0,12);if(!trimmed)throw new Error('닉네임을 입력해 주세요.');return trimmed;}
function deleteRoom(room:Room){const timer=runoutTimers.get(room.code);if(timer)clearTimeout(timer);runoutTimers.delete(room.code);for(const player of room.players){sessions.delete(player.sessionId);sockets.delete(player.id);}rooms.delete(room.code);broadcastLobby();}
function removeFromRoom(room:Room,player:Player){
  room.players=room.players.filter(candidate=>candidate.id!==player.id);sockets.delete(player.id);sessions.delete(player.sessionId);
  if(room.players.length===0){deleteRoom(room);return;}
  if(room.hostId===player.id)room.hostId=[...room.players].sort((a,b)=>a.seat-b.seat)[0].id;
  room.version++;broadcast(room);
}

app.get('/health',async()=>({ok:true,rooms:rooms.size}));
app.get('/ws',{websocket:true},socket=>{
  let current:{room:Room;player:Player}|undefined;
  (socket as any).isAlive=true;socket.on('pong',()=>{(socket as any).isAlive=true;});
  clients.add(socket);send(socket,{type:'room_list',rooms:roomList()});
  socket.on('message',(raw:Buffer)=>{
    let msg:ClientMessage;
    try{msg=JSON.parse(raw.toString());}catch{return send(socket,{type:'error',code:'BAD_JSON',message:'잘못된 요청입니다.'});}
    try{
      if(msg.type==='create_room'){
        const playerNickname=nickname(msg.nickname);
        if(current&&(current.room.status==='WAITING'||current.room.status==='HAND_END'))removeFromRoom(current.room,current.player);
        const player=newPlayer(playerNickname,msg.sessionId||randomUUID(),1);const room=newRoom(player,code());rooms.set(room.code,room);current={room,player};sessions.set(player.sessionId,current);
      }else if(msg.type==='join_room'){
        const room=rooms.get(msg.roomCode);if(!room||room.status!=='WAITING'||room.players.length>=8)throw new Error('참가할 수 없는 방입니다.');
        const playerNickname=nickname(msg.nickname);
        const old=sessions.get(msg.sessionId);
        if(old&&old.room===room){current=old;old.player.connected=true;}
        else{if(current&&(current.room.status==='WAITING'||current.room.status==='HAND_END'))removeFromRoom(current.room,current.player);const seat=Array.from({length:8},(_,i)=>i+1).find(value=>!room.players.some(player=>player.seat===value))!;const player=newPlayer(playerNickname,msg.sessionId,seat);room.players.push(player);current={room,player};sessions.set(player.sessionId,current);room.version++;}
      }else{
        if(!current)throw new Error('먼저 방에 참가하세요.');const {room,player}=current;
        if(!room.players.some(candidate=>candidate.id===player.id)){current=undefined;throw new Error('더 이상 이 방에 참가하고 있지 않습니다.');}
        if(msg.type==='ready'){player.ready=msg.ready;room.version++;}
        else if(msg.type==='start'){if(room.hostId!==player.id)throw new Error('방장만 시작할 수 있습니다.');startHand(room);}
        else if(msg.type==='continue'){if(room.hostId!==player.id)throw new Error('방장만 다음 게임을 준비할 수 있습니다.');continueAfterHand(room,msg.reset);}
        else if(msg.type==='kick'){
          if(room.hostId!==player.id)throw new Error('방장만 강퇴할 수 있습니다.');if(room.status!=='WAITING')throw new Error('대기방에서만 강퇴할 수 있습니다.');if(msg.playerId===player.id)throw new Error('자신은 강퇴할 수 없습니다.');
          const target=room.players.find(candidate=>candidate.id===msg.playerId);if(!target)throw new Error('플레이어를 찾을 수 없습니다.');for(const ws of sockets.get(target.id)??[])send(ws,{type:'kicked',message:'방장에 의해 방에서 나왔습니다.'});removeFromRoom(room,target);
        }else if(msg.type==='leave'){
          if(room.status!=='WAITING'&&room.status!=='HAND_END')throw new Error('게임 중에는 나갈 수 없습니다.');removeFromRoom(room,player);current=undefined;send(socket,{type:'room_list',rooms:roomList()});return;
        }else applyAction(room,player.id,msg.action,msg.commandId,msg.expectedVersion);
      }
      if(current){if(!sockets.has(current.player.id))sockets.set(current.player.id,new Set());sockets.get(current.player.id)!.add(socket);send(socket,{type:'welcome',playerId:current.player.id,sessionId:current.player.sessionId});broadcast(current.room);}
    }catch(error){send(socket,{type:'error',commandId:msg.commandId,code:'INVALID_COMMAND',message:error instanceof Error?error.message:'요청 실패'});}
  });
  socket.on('close',()=>{clients.delete(socket);if(current){const {room,player}=current;const playerSockets=sockets.get(player.id);playerSockets?.delete(socket);if(playerSockets?.size)return;player.connected=false;if(room.status==='WAITING'||room.status==='HAND_END'){if(room.players.some(candidate=>candidate.id===player.id))removeFromRoom(room,player);}else if(room.players.every(candidate=>!candidate.connected))deleteRoom(room);else{if(room.hostId===player.id)room.hostId=room.players.filter(candidate=>candidate.connected).sort((a,b)=>a.seat-b.seat)[0].id;room.version++;broadcast(room);}}});
});

setInterval(()=>{for(const room of rooms.values())if(expireTurn(room))broadcast(room);},500);
setInterval(()=>{for(const socket of clients){if((socket as any).isAlive===false){socket.terminate();continue;}(socket as any).isAlive=false;socket.ping();}},5_000);

const port=Number(process.env.PORT??8787);
await app.listen({port,host:'0.0.0.0'});
