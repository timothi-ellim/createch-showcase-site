import { canMove } from './preferences';
import { flow, onFrame } from './flow';
import '../../styles/living-field.css';

type Bird = { x: number; y: number; vx: number; vy: number };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const forced = matchMedia('(forced-colors: active)');
const scenes: Scene[] = [];
let away = false, geometryDirty = true;
const allowed = () => !away && canMove() && !forced.matches &&
  document.documentElement.dataset.loopMotion === 'running' &&
  !document.querySelector('dialog[open]');

class Scene {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  visible = false;
  width = 1; height = 1;
  pointer = { x: -1000, y: -1000, active: false };
  impulse = 0;
  birds: Bird[] = [];
  snapshot: Bird[] = [];
  left = 0; top = 0;
  hero: boolean;
  tone = '88,53,150';
  motif = 'signals';
  quiet: {x:number;y:number;w:number;h:number}[] = [];
  layer = document.createElement('div');
  constructor(public host: HTMLElement) {
    this.hero = host.matches('.hero');
    this.motif = this.hero ? 'orbit' : host.matches('.home-projects,.discovery-heading,.detail-identity') ? 'contours' : host.matches('.home-themes') ? 'themes' : host.matches('.home-about,.roster-section,.news-social') ? 'network' : location.pathname.includes('visit') || host.matches('.home-map') ? 'paths' : 'signals';
    this.canvas.dataset.livingField = this.hero ? 'flock' : this.motif;
    host.dataset.backgroundMotif = this.motif;
    this.canvas.dataset.running = 'false';
    this.canvas.setAttribute('aria-hidden', 'true');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    this.ctx = context;
    host.dataset.livingHost = '';
    if(getComputedStyle(host).position==='static')host.style.position='relative';host.style.isolation='isolate';
    this.layer.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:-1;contain:paint';
    this.canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';
    this.layer.className='section-atmosphere';this.layer.setAttribute('aria-hidden','true');
    this.layer.append(this.canvas);host.prepend(this.layer);
    let surface:Element|null=host;
    while(surface){const rgb=getComputedStyle(surface).backgroundColor.match(/[\d.]+/g)?.map(Number);if(rgb&&rgb.length>=3&&(rgb.length<4||rgb[3]>.8)){this.tone=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722<130?'235,235,155':'88,53,150';break;}surface=surface.parentElement;}
    this.resize();
  }
  measure() {
    const rect=this.canvas.getBoundingClientRect();this.left=rect.left;this.top=rect.top+scrollY;
    // Cached, padded reading zones complement real stacking order. Clear each
    // rectangle separately so overlapping zones never reopen holes.
    this.quiet=[];
    for(const el of this.host.querySelectorAll('h1,h2,h3,h4,p,dt,dd,a,button,label,summary,input,select,textarea,img,video,article,.reading-panel,.exhibition-window,.theme-tile,.participant-roster,.venue-mark,[data-living-region]')){
      const range=document.createRange();range.selectNodeContents(el);
      const r=el.matches('h1,h2,h3,h4,p,dt,dd')?range.getBoundingClientRect():el.getBoundingClientRect();if(!r.width||!r.height)continue;
      const pad=el.matches('.exhibition-window')?48:el.matches('h1,h2,h3,h4,p,dt,dd')?14:12;
      this.quiet.push({x:r.left-rect.left-pad,y:r.top-rect.top-pad,w:r.width+pad*2,h:r.height+pad*2});
    }
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.measure();
    if(this.width===Math.max(1,rect.width)&&this.height===Math.max(1,rect.height))return;
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    const ratio = Math.min(devicePixelRatio || 1, coarse.matches ? 1 : 1.25);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if(!this.birds.length) this.birds = this.hero ? Array.from({ length: coarse.matches ? 10 : 22 }, (_, i) => ({
      x: this.width * .44 + Math.cos(i * 2.4) * 65,
      y: 45 + Math.sin(i * 2.4) * 22,
      vx: Math.cos(i) * .4, vy: Math.sin(i) * .4,
    })) : [];
    this.snapshot=this.birds.map(b=>({...b}));
    this.draw(flow.phase, 0);
  }
  draw(time: number, step: number) {
    const c = this.ctx, w = this.width, h = this.height;
    const color = this.tone;
    c.clearRect(0, 0, w, h);
    this.pointer.x=flow.x-this.left;this.pointer.y=flow.y-(this.top-scrollY);this.pointer.active=flow.active;
    const point=(x:number,y:number)=>{
      let ox=flow.vx*2,oy=flow.vy*2;
      if(this.pointer.active){const dx=x-this.pointer.x,dy=y-this.pointer.y,d=Math.max(1,Math.hypot(dx,dy)),force=Math.exp(-d/160)*14;ox+=dx/d*force;oy+=dy/d*force;}
      for(const p of flow.pulses){const dx=x-(p.x*innerWidth-this.left),dy=y-(p.y*innerHeight-this.top+scrollY),d=Math.max(1,Math.hypot(dx,dy));const f=Math.exp(-Math.abs(d-p.age*450)/80)*20*p.power;ox+=dx/d*f;oy+=dy/d*f;}
      return {x:x+ox,y:y+oy};
    };
    c.lineWidth=1.2;c.strokeStyle=`rgba(${color},.25)`;
    // Compositions repeat vertically only on long reading sections, with a
    // shared phase but section-specific shapes and an alternating anchor.
    for(let band=0;band<Math.ceil(h/650);band++){
      const cy=this.hero?(w<600?10:85):band*650+Math.min(280,h*.42),cx=w*(this.hero?.47:band%2?.18:.82);
      const centre=point(cx,cy),radius=this.hero&&w<600?48:Math.min(w*.2,180);
      if(this.motif==='orbit'||this.motif==='themes'){
        for(let i=0;i<3;i++){
          const angle=time*(i%2?-.055:.075)+i*1.9;
          c.beginPath();c.ellipse(centre.x,centre.y,radius*(.7+i*.25),radius*(.42+i*.17),-.4+i*.3,angle,angle+Math.PI*1.35);c.stroke();
          c.fillStyle=`rgba(${color},.65)`;c.beginPath();c.arc(centre.x+Math.cos(angle)*radius*.8,centre.y+Math.sin(angle)*radius*.55,2.5,0,Math.PI*2);c.fill();
        }
      }else if(this.motif==='network'){
        let last:{x:number;y:number}|null=null;
        for(let i=0;i<(coarse.matches?5:8);i++){
          const angle=i*2.399+time*.035;
          const p=point(cx+Math.cos(angle)*radius*(.5+i*.07),cy+Math.sin(angle)*radius*(.4+i*.055));
          if(last){c.beginPath();c.moveTo(last.x,last.y);c.lineTo(p.x,p.y);c.stroke();}
          c.fillStyle=`rgba(${color},.5)`;c.beginPath();c.arc(p.x,p.y,i%3?2:3.5,0,Math.PI*2);c.fill();last=p;
        }
      }else{
        for(let i=0;i<(coarse.matches?2:3);i++){
          const y=cy+i*27,drift=Math.sin(time*.11+i)*12;
          const pathAt=(t:number)=>{
            const u=1-t;
            const bend=this.motif==='signals'?Math.sin(time*.1+i)*4:this.motif==='contours'?(t<.3?40:t>.7?-40:40-(t-.3)*200):40*u*u*u-210*u*u*t+210*u*t*t-40*t*t*t;
            return point(cx-radius+radius*2*t,y+bend+drift);
          };
          c.beginPath();
          for(let k=0;k<=40;k++){const p=pathAt(k/40);if(k===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);}
          if(this.motif==='signals')c.setLineDash([18,12]);c.stroke();c.setLineDash([]);
          const t=(time*.045+i*.3)%1,dot=pathAt(t);
          c.fillStyle=`rgba(${color},.6)`;c.beginPath();c.arc(dot.x,dot.y,2.4,0,Math.PI*2);c.fill();
        }
      }
      // A sparse counterweight on the opposite edge connects the composition.
      for(let i=0;i<4;i++){
        const p=point(w-cx+Math.sin(time*.08+i)*24,cy-100+i*42);
        c.beginPath();c.moveTo(p.x-4,p.y);c.lineTo(p.x+4,p.y);c.stroke();
      }
    }
    for(const pulse of flow.pulses){
      const x=pulse.x*innerWidth-this.left,y=pulse.y*innerHeight-this.top+scrollY;
      const t=Math.min(1,pulse.age/.65),r=12+180*(1-(1-t)**3);
      c.strokeStyle=`rgba(${color},${.4*(1-t)**2})`;c.beginPath();c.arc(x,y,r,.2,Math.PI*1.25);c.stroke();
    }
    // A slow shared current, separation, alignment and cohesion give the flock
    // inertia. Compute against one snapshot so array order cannot steer it.
    this.birds.forEach((b,i)=>Object.assign(this.snapshot[i],b));
    const old = this.snapshot;
    this.birds.forEach((b, i) => {
      let ax=0, ay=0, vx=0, vy=0, cx=0, cy=0, count=0;
      for (let j=0;j<old.length;j++) {
        if(i===j)continue;
        const other=old[j], dx=b.x-other.x, dy=b.y-other.y, d=Math.hypot(dx,dy);
        if(d<90){vx+=other.vx;vy+=other.vy;cx+=other.x;cy+=other.y;count++;}
        if(d<22 && d>0){ax+=dx/(d*d)*1.5;ay+=dy/(d*d)*1.5;}
      }
      if(count){ax+=(vx/count-b.vx)*.025+(cx/count-b.x)*.0005;ay+=(vy/count-b.vy)*.025+(cy/count-b.y)*.0005;}
      ax+=(w*.44+Math.sin(time*.22)*80-b.x)*.00045;
      ay+=(55+Math.cos(time*.26)*22-b.y)*.00065;
      const dx=b.x-this.pointer.x,dy=b.y-this.pointer.y,d=Math.max(1,Math.hypot(dx,dy));
      if(this.pointer.active&&d<150){const f=(1-d/150)*.12;ax+=dx/d*f;ay+=dy/d*f;}
      for(const pulse of flow.pulses){
        const dx=b.x-(pulse.x*innerWidth-this.left),dy=b.y-(pulse.y*innerHeight-(this.top-scrollY));
        const distance=Math.max(1,Math.hypot(dx,dy));
        if(distance<190){const force=(1-distance/190)*Math.exp(-pulse.age*8)*pulse.power*.7;ax+=dx/distance*force;ay+=dy/distance*force;}
      }
      b.vx=(b.vx+ax*step)*Math.pow(.985,step); b.vy=(b.vy+ay*step)*Math.pow(.985,step);
      const speed=Math.hypot(b.vx,b.vy);if(speed>1.8){b.vx*=1.8/speed;b.vy*=1.8/speed;}
      b.x=Math.max(8,Math.min(w-8,b.x+b.vx*step));b.y=Math.max(10,Math.min(Math.min(h-10,180),b.y+b.vy*step));
      const angle=Math.atan2(b.vy,b.vx);
      c.beginPath();c.moveTo(b.x,b.y);c.lineTo(b.x-Math.cos(angle)*5,b.y-Math.sin(angle)*5);
      c.strokeStyle=`rgba(${color},.65)`;c.lineWidth=2;c.stroke();
    });
    for(const r of this.quiet)c.clearRect(r.x,r.y,r.w,r.h);
    this.impulse *= Math.pow(.94, step);
  }
}

function stop() {
  scenes.forEach(scene=>{scene.canvas.dataset.running='false';scene.pointer.active=false;scene.impulse=0;});
}
onFrame(dt => {
  if(!allowed() || !scenes.some(s=>s.visible)){stop();return;}
  if(geometryDirty){for(const scene of scenes)if(scene.visible)scene.measure();geometryDirty=false;}
  for(const scene of scenes)if(scene.visible){scene.draw(flow.phase,dt*60);if(scene.canvas.dataset.running!=='true')scene.canvas.dataset.running='true';}
});
function sync(){if(!allowed())stop();}
const observer=new IntersectionObserver(entries=>{
  for(const entry of entries){const scene=scenes.find(s=>s.canvas===entry.target);if(scene){scene.visible=entry.isIntersecting;if(!scene.visible){scene.canvas.dataset.running='false';scene.pointer.active=false;}}}geometryDirty=true;sync();
});
const candidates=[...document.querySelectorAll<HTMLElement>('main > section, main > .wrap, main > .light-section, .hero, .home-themes, .home-projects, .home-about, .roster-section, .news-social, .home-map, .discovery-heading, .detail-identity, [data-living-region], .site-footer')];
// Prefer the outer section: nested canvases would double both motion and cost.
const hosts=candidates.filter(host=>host.matches('[data-living-region]')||!candidates.some(other=>other!==host&&other.contains(host)));
for(const host of hosts){
  try { const scene=new Scene(host);scenes.push(scene);observer.observe(scene.canvas); } catch { /* Content remains fully usable without a canvas context. */ }
}
const resize=new ResizeObserver(entries=>{for(const entry of entries)scenes.find(s=>s.host===entry.target)?.resize();geometryDirty=true;sync();});scenes.forEach(s=>resize.observe(s.host));
new ResizeObserver(()=>{geometryDirty=true;}).observe(document.body);
document.addEventListener('load',()=>{geometryDirty=true;},true);
new MutationObserver(()=>{geometryDirty=true;}).observe(document.querySelector('main')!,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','class']});
window.addEventListener('scroll',()=>{geometryDirty=true;},{passive:true});
document.addEventListener('createch:motion-policy',sync);
document.addEventListener('visibilitychange',sync);
reduced.addEventListener('change',sync);forced.addEventListener('change',sync);
document.addEventListener('focusin',()=>scenes.forEach(s=>{s.pointer.active=false;}));
new MutationObserver(sync).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
window.addEventListener('pagehide',()=>{away=true;stop();});
window.addEventListener('pageshow',()=>{away=false;sync();});
sync();
