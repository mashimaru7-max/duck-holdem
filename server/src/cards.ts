import type {Card, Rank, Suit} from '@duck-holdem/shared';
const suits:Suit[]=['C','D','H','S']; const ranks:Rank[]=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export function createDeck():Card[]{return suits.flatMap(s=>ranks.map(r=>`${r}${s}` as Card));}
export function shuffle(deck:Card[], random=Math.random):Card[]{
  const copy=[...deck]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]];} return copy;
}
const rankValue:Record<Rank,number>=Object.fromEntries(ranks.map((r,i)=>[r,i+2])) as Record<Rank,number>;
export interface HandScore {category:number; values:number[]; name:string}
function five(cards:Card[]):HandScore{
  const values=cards.map(c=>rankValue[c[0] as Rank]).sort((a,b)=>b-a); const suits5=cards.map(c=>c[1]);
  const counts=new Map<number,number>(); values.forEach(v=>counts.set(v,(counts.get(v)??0)+1));
  const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]); const unique=[...new Set(values)]; if(unique[0]===14) unique.push(1);
  let highStraight=0; for(let i=0;i<=unique.length-5;i++) if(unique[i]-unique[i+4]===4){highStraight=unique[i];break;}
  const flush=suits5.every(s=>s===suits5[0]);
  if(flush&&highStraight)return{category:8,values:[highStraight],name:'스트레이트 플러시'};
  if(groups[0][1]===4)return{category:7,values:[groups[0][0],groups[1][0]],name:'포카드'};
  if(groups[0][1]===3&&groups[1][1]===2)return{category:6,values:[groups[0][0],groups[1][0]],name:'풀하우스'};
  if(flush)return{category:5,values,name:'플러시'};
  if(highStraight)return{category:4,values:[highStraight],name:'스트레이트'};
  if(groups[0][1]===3)return{category:3,values:[groups[0][0],...groups.slice(1).map(g=>g[0]).sort((a,b)=>b-a)],name:'트리플'};
  if(groups[0][1]===2&&groups[1][1]===2){const pairs=[groups[0][0],groups[1][0]].sort((a,b)=>b-a);return{category:2,values:[...pairs,groups[2][0]],name:'투페어'};}
  if(groups[0][1]===2)return{category:1,values:[groups[0][0],...groups.slice(1).map(g=>g[0]).sort((a,b)=>b-a)],name:'원페어'};
  return{category:0,values,name:'하이카드'};
}
function combinations<T>(a:T[],n:number):T[][]{if(n===0)return[[]]; if(a.length<n)return[]; return combinations(a.slice(1),n-1).map(x=>[a[0],...x]).concat(combinations(a.slice(1),n));}
export function compareScore(a:HandScore,b:HandScore){if(a.category!==b.category)return a.category-b.category; for(let i=0;i<Math.max(a.values.length,b.values.length);i++){const d=(a.values[i]??0)-(b.values[i]??0);if(d)return d;}return 0;}
export function evaluate(cards:Card[]):HandScore{if(cards.length<5)throw new Error('카드는 5장 이상이어야 합니다.'); return combinations(cards,5).map(five).sort((a,b)=>compareScore(b,a))[0];}
