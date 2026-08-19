import Fastify from 'fastify';import cors from '@fastify/cors';import websocket from '@fastify/websocket';import {randomUUID} from 'node:crypto';
import type {ClientMessage,ServerMessage} from '@duck-holdem/shared';import {applyAction,continueAfterHand,newPlayer,newRoom,startHand,viewFor,type Player,type Room} from './engine.js';
const app=Fastify({logger:true});await app.register(cors,{origin:true});await app.register(websocket);
const rooms=new Map<string,Room>();const sockets=new Map<string,Set<any>>();const sessions=new Map<string,{room:Room;player:Player}>();
const send=(ws:any,msg:ServerMessage)=>ws.send(JSON.stringify(msg));
function broadcast(room:Room){for(const p of room.players)for(const ws of sockets.get(p.id)??[])send(ws,{type:'state',state:viewFor(room,p)});}
function code(){let c='';do{c=String(Math.floor(1000+Math.random()*9000));}while(rooms.has(c));return c;}
app.get('/health',async()=>({ok:true,rooms:rooms.size}));
app.get('/ws',{websocket:true},(socket)=>{let current:{room:Room;player:Player}|undefined;
  socket.on('message',(raw:Buffer)=>{let msg:ClientMessage;try{msg=JSON.parse(raw.toString());}catch{return send(socket,{type:'error',code:'BAD_JSON',message:'잘못된 요청입니다.'});}
    try{
      if(msg.type==='create_room'){const p=newPlayer(msg.nickname.trim().slice(0,12),msg.sessionId||randomUUID(),1);const room=newRoom(p,code());rooms.set(room.code,room);current={room,player:p};sessions.set(p.sessionId,current);}
      else if(msg.type==='join_room'){const room=rooms.get(msg.roomCode);if(!room||room.status!=='WAITING'||room.players.length>=8)throw new Error('참가할 수 없는 방입니다.');const old=sessions.get(msg.sessionId);if(old&&old.room===room){current=old;old.player.connected=true;}else{const seat=Array.from({length:8},(_,i)=>i+1).find(s=>!room.players.some(p=>p.seat===s))!;const p=newPlayer(msg.nickname.trim().slice(0,12),msg.sessionId,seat);room.players.push(p);current={room,player:p};sessions.set(p.sessionId,current);room.version++;}}
      else {if(!current)throw new Error('먼저 방에 참가하세요.');const {room,player}=current;if(msg.type==='ready'){player.ready=msg.ready;room.version++;}else if(msg.type==='start'){if(room.hostId!==player.id)throw new Error('방장만 시작할 수 있습니다.');startHand(room);}else if(msg.type==='continue'){if(room.hostId!==player.id)throw new Error('방장만 다음 게임을 준비할 수 있습니다.');continueAfterHand(room,msg.reset);}else applyAction(room,player.id,msg.action,msg.commandId,msg.expectedVersion);}
      if(current){if(!sockets.has(current.player.id))sockets.set(current.player.id,new Set());sockets.get(current.player.id)!.add(socket);send(socket,{type:'welcome',playerId:current.player.id,sessionId:current.player.sessionId});broadcast(current.room);}
    }catch(e){send(socket,{type:'error',commandId:msg.commandId,code:'INVALID_COMMAND',message:e instanceof Error?e.message:'요청 실패'});}
  });
  socket.on('close',()=>{if(current){sockets.get(current.player.id)?.delete(socket);current.player.connected=false;current.room.version++;broadcast(current.room);}});
});
const port=Number(process.env.PORT??8787);await app.listen({port,host:'0.0.0.0'});
