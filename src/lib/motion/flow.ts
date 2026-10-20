import { canMove } from './preferences';

type Pulse={x:number;y:number;age:number;power:number;light:boolean};
type State={phase:number;x:number;y:number;vx:number;vy:number;pulses:Pulse[]};
const root=document.documentElement;
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),forced=matchMedia('(forced-colors: active)');
const print=matchMedia('print');
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export const flow={phase:0,x:innerWidth/2,y:innerHeight/2,tx:innerWidth/2,ty:innerHeight/2,active:false,vx:0,vy:0,pulses:[] as Pulse[]};
export const moving=()=>!away&&canMove()&&!forced.matches&&!print.matches&&root.dataset.loopMotion==='running'&&!document.querySelector('dialog[open]');
const listeners=new Set<(dt:number)=>void>();
export const onFrame=(fn:(dt:number)=>void)=>{listeners.add(fn);};
let raf=0,previous=0,away=false,lastScroll=scrollY,scrollSpeed=0,lastDown:EventTarget|null=null,downAt=0;
let width=innerWidth,height=innerHeight;
// Shared state belongs to the document; visible drawing belongs to sections.
export const field=document.createElement('span');
field.hidden=true;field.dataset.flowController='';field.dataset.impact='0';field.dataset.running='false';field.setAttribute('aria-hidden','true');
document.body.append(field);root.dataset.flowReady='';
function resize(){width=innerWidth;height=innerHeight;}
function stop(){if(raf)cancelAnimationFrame(raf);raf=0;previous=0;flow.active=false;flow.pulses=[];field.dataset.running='false';}
function tick(now:number){
  raf=0;if(!moving()){stop();return;}
  const dt=previous?clamp((now-previous)/1000,0,.04):0;previous=now;flow.phase+=dt;
  const t=1-Math.exp(-dt/.055);flow.x+=(flow.tx-flow.x)*t;flow.y+=(flow.ty-flow.y)*t;
  flow.vx*=Math.exp(-dt*6);flow.vy+=(clamp(scrollSpeed*.002,-1.5,1.5)-flow.vy)*t;scrollSpeed*=Math.exp(-dt*9);
  for(let i=flow.pulses.length-1;i>=0;i--){flow.pulses[i].age+=dt;if(flow.pulses[i].age>.7)flow.pulses.splice(i,1);}
  for(const fn of listeners)fn(dt);if(field.dataset.running!=='true')field.dataset.running='true';
  raf=requestAnimationFrame(tick);
}
function sync(){if(!moving()){stop();return;}if(!raf)raf=requestAnimationFrame(tick);}
function darkSurface(target:EventTarget|null){
  let el=target instanceof Element?target:null;
  while(el){const color=getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);if(color&&color.length>=3&&(color.length<4||color[3]>.8))return color[0]*.2126+color[1]*.7152+color[2]*.0722<130;el=el.parentElement;}return false;
}
function impulse(x:number,y:number,target:EventTarget|null){
  if(!moving()||target instanceof Element&&target.closest('[data-motion-toggle]'))return;
  const nx=clamp(x/width,0,1),ny=clamp(y/height,0,1);
  if(flow.pulses.length>=4)flow.pulses.shift();flow.pulses.push({x:nx,y:ny,age:0,power:1,light:darkSurface(target)});
  flow.vx=clamp((nx-.5)*1.5,-.75,.75);field.dataset.impact=String(Number(field.dataset.impact)+1);sync();
}
document.addEventListener('pointermove',e=>{if(e.pointerType==='touch'||!moving())return;flow.tx=e.clientX;flow.ty=e.clientY;flow.active=true;},{passive:true});
document.addEventListener('pointerdown',e=>{if(e.button!==0||!moving())return;lastDown=e.target;downAt=performance.now();impulse(e.clientX,e.clientY,e.target);},{passive:true});
document.addEventListener('click',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||!moving())return;
  if(e.detail>0&&e.target===lastDown&&performance.now()-downAt<1500)return;
  const box=e.target instanceof Element?e.target.getBoundingClientRect():null;
  impulse(e.detail===0&&box?box.x+box.width/2:e.clientX,e.detail===0&&box?box.y+box.height/2:e.clientY,e.target);
});
document.addEventListener('pointercancel',()=>{lastDown=null;flow.active=false;flow.pulses=[];});
document.addEventListener('pointerleave',()=>{flow.active=false;});
document.addEventListener('focusin',()=>{flow.active=false;});
window.addEventListener('blur',()=>{flow.active=false;lastDown=null;});
window.addEventListener('scroll',()=>{scrollSpeed=scrollY-lastScroll;lastScroll=scrollY;},{passive:true});
window.addEventListener('resize',resize);



function capture():State{return{phase:flow.phase,x:flow.x/width,y:flow.y/height,vx:flow.vx,vy:flow.vy,pulses:flow.pulses.map(p=>({...p}))};}
function restore(value:State){
  if(!value||![value.phase,value.x,value.y,value.vx,value.vy].every(Number.isFinite))return;
  flow.phase=clamp(value.phase,0,1e7);flow.x=flow.tx=clamp(value.x,0,1)*width;flow.y=flow.ty=clamp(value.y,0,1)*height;
  flow.vx=clamp(value.vx,-2,2);flow.vy=clamp(value.vy,-2,2);
  flow.pulses=Array.isArray(value.pulses)?value.pulses.slice(-4).filter(p=>p&&[p.x,p.y,p.age,p.power].every(Number.isFinite)).map(p=>({x:clamp(p.x,0,1),y:clamp(p.y,0,1),age:clamp(p.age,0,.7),power:clamp(p.power,0,1),light:p.light===true})):[];
  root.dataset.flowRestored='true';
}
document.addEventListener('createch:flow-capture',e=>{const detail=(e as CustomEvent).detail;if(detail&&typeof detail==='object')detail.state=capture();});
document.addEventListener('createch:flow-restore',e=>restore((e as CustomEvent).detail));
try{if(root.dataset.flowSnapshot)restore(JSON.parse(root.dataset.flowSnapshot));}catch{/* Navigation never depends on storage. */}
document.addEventListener('createch:motion-policy',sync);document.addEventListener('visibilitychange',sync);
reduced.addEventListener('change',sync);forced.addEventListener('change',sync);
print.addEventListener('change',sync);
new MutationObserver(sync).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
window.addEventListener('pagehide',()=>{away=true;stop();});window.addEventListener('pageshow',()=>{away=false;sync();});
sync();
