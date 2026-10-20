// Native cross-document transitions only. No intercepted links, router,
// artificial navigation delays or replacement of history/scroll handling.
(() => {
  const root = document.documentElement;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const publicPages = new Set(['/', '/explore/', '/visit/', '/my-visit/', '/about/', '/programme/',
    '/participants/', '/privacy/', '/poster/', '/sharing/', '/reminders/', '/reminder-privacy/', '/map/', '/404.html']);
  const supportedPath = path => publicPages.has(path) || /^\/projects\/[^/]+\/$/.test(path);
  let active = null;
  let departing = false;
  const handoffKey = 'createch-motion-handoff';
  function handoffFrom() {
    try {
      const value=JSON.parse(sessionStorage.getItem(handoffKey) || 'null');
      sessionStorage.removeItem(handoffKey);
      if(value && value.to===location.pathname && Date.now()-value.at>=0 && Date.now()-value.at<10000 &&
         typeof value.from==='string' && supportedPath(value.from)) return value;
    } catch {}
    return null;
  }
  const allowed = () => {
    if(preference.matches || root.dataset.motionLevel !== 'full' || root.dataset.loopMotion === 'paused') return false;
    try { if(localStorage.getItem('createch-motion-paused') === 'true') return false; } catch {}
    return !document.querySelector('dialog[open]');
  };
  function motionState(value) {
    if(!value || ![value.phase,value.x,value.y,value.vx,value.vy].every(Number.isFinite))return null;
    const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
    return {phase:clamp(value.phase,0,1e7),x:clamp(value.x,0,1),y:clamp(value.y,0,1),
      vx:clamp(value.vx,-2,2),vy:clamp(value.vy,-2,2),
      pulses:Array.isArray(value.pulses)?value.pulses.slice(-4).filter(p=>p&&[p.x,p.y,p.age,p.power].every(Number.isFinite)).map(p=>({x:clamp(p.x,0,1),y:clamp(p.y,0,1),age:clamp(p.age,0,.7),power:clamp(p.power,0,1),light:p.light===true})):[]};
  }
  function clear() {
    document.querySelectorAll('[data-journey-art]').forEach(el => { el.style.removeProperty('view-transition-name');delete el.dataset.journeyArt; });
    delete root.dataset.journeyActive;
  }
  function visible(img) {
    if(!img || !img.complete || !img.naturalWidth)return false;
    const box=img.getBoundingClientRect();
    return box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight;
  }
  function artwork(projectPath) {
    if(location.pathname===projectPath) return document.querySelector('[data-project-body] .project-media img');
    const links=[...document.querySelectorAll('a[href]')].filter(a => a.origin===location.origin && a.pathname===projectPath);
    for(const link of links) {
      const img=link.querySelector('img') || link.closest('[data-project-card]')?.querySelector('.project-media img');
      if(visible(img))return img;
    }
    return null;
  }
  function prepare(event, incoming) {
    const transition=event.viewTransition;
    if(!transition)return;
    clear(); active=transition;
    const activation=incoming ? window.navigation?.activation : event.activation;
    // no-referrer can redact activation.from.url. Only public route paths are
    // handed off within this tab; failure simply uses the generic transition.
    const handedFrom=incoming ? handoffFrom() : null;
    const otherURL=incoming ? (activation?.from?.url || (handedFrom?new URL(handedFrom.from,location.origin).href:null)) : activation?.entry?.url;
    let other;
    try {if(otherURL)other=new URL(otherURL);} catch {}
    if(!allowed() || (other && (other.origin!==location.origin || !supportedPath(other.pathname))) || !supportedPath(location.pathname)) {
      transition.skipTransition();return;
    }
    const backward=activation?.entry?.index < activation?.from?.index;
    root.style.setProperty('--journey-direction',backward?'-1':'1');
    if(incoming){
      // Only bounded numeric animation state crosses the navigation. No content,
      // query strings, preferences, participant data or visitor shortlist entries.
      delete root.dataset.flowSnapshot;delete root.dataset.flowRestored;
      const motion=motionState(handedFrom?.motion);
      if(motion){root.dataset.flowSnapshot=JSON.stringify(motion);document.dispatchEvent(new CustomEvent('createch:flow-restore',{detail:motion}));}
    }else if(other){
      const detail={state:null};document.dispatchEvent(new CustomEvent('createch:flow-capture',{detail}));
      try {sessionStorage.setItem(handoffKey,JSON.stringify({from:location.pathname,to:other.pathname,at:Date.now(),motion:motionState(detail.state)}));} catch {}
    }
    const projectPath=[location.pathname,other?.pathname || ''].find(p=>/^\/projects\/[^/]+\/$/.test(p));
    const img=projectPath ? artwork(projectPath) : null;
    if(visible(img)){img.style.viewTransitionName='project-artwork';img.dataset.journeyArt='';}
    root.dataset.journeyActive='';
    transition.finished.catch(()=>{}).finally(()=>{if(active===transition){clear();active=null;}});
  }
  addEventListener('pageswap',event=>{prepare(event,false);departing=true;});
  addEventListener('pagereveal',event=>{departing=false;prepare(event,true);});
  addEventListener('pageshow',event=>{if(event.persisted && !active)clear();});
  preference.addEventListener('change',()=>{if(preference.matches)active?.skipTransition();});
  new MutationObserver(()=>{if(!departing && !allowed())active?.skipTransition();}).observe(root,{attributes:true,attributeFilter:['data-loop-motion','data-motion-level']});
})();
