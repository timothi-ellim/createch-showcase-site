import { test, expect } from '@playwright/test';

test('touch impulses act at the tap location, independently of the last mouse position', async ({page}) => {
  await page.addInitScript(() => {
    let id=0; const pending=new Map<number,FrameRequestCallback>();
    let heads:{x:number;y:number}[]=[];
    window.requestAnimationFrame=callback=>{pending.set(++id,callback);return id;};
    window.cancelAnimationFrame=key=>{pending.delete(key);};
    Reflect.set(window,'driveFlow',(time:number)=>{heads=[];const next=[...pending.values()];pending.clear();next.forEach(fn=>fn(time));return heads;});
    const points=new WeakMap<CanvasRenderingContext2D,{x:number;y:number}>();
    const move=CanvasRenderingContext2D.prototype.moveTo,line=CanvasRenderingContext2D.prototype.lineTo;
    CanvasRenderingContext2D.prototype.moveTo=function(x,y){points.set(this,{x,y});return move.call(this,x,y);};
    CanvasRenderingContext2D.prototype.lineTo=function(x,y){
      const from=points.get(this);
      if(from&&this.canvas.closest('.hero')&&this.lineWidth===2&&Math.abs(Math.hypot(x-from.x,y-from.y)-5)<.01)heads.push({...from});
      return line.call(this,x,y);
    };
  });
  async function scenario(near:boolean){
    await page.goto('/');await expect(page.locator('.hero canvas')).toHaveCount(1);
    await page.waitForTimeout(80);
    return page.evaluate(near=>{
      const drive=Reflect.get(window,'driveFlow') as (time:number)=>{x:number;y:number}[];
      let birds:{x:number;y:number}[]=[];
      for(let i=1;i<=20;i++)birds=drive(i*16.667);
      const box=document.querySelector('.hero canvas')!.getBoundingClientRect();
      document.querySelector('.hero')!.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',button:0,clientX:box.left+birds[0].x-30,clientY:near?box.top+birds[0].y:innerHeight-5}));
      for(let i=21;i<=28;i++)birds=drive(i*16.667);
      return birds;
    },near);
  }
  const far=await scenario(false),near=await scenario(true);
  expect(far.length).toBeGreaterThan(5);
  expect(Math.max(...near.map((p,i)=>Math.hypot(p.x-far[i].x,p.y-far[i].y)))).toBeGreaterThan(.5);
});

test('background draws on display frames instead of skipping alternate frames', async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.clearRect;
    Reflect.set(window, 'flowDraws', 0);
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      if (this.canvas.closest('.hero') && args[0]===0 && args[1]===0) Reflect.set(window, 'flowDraws', Reflect.get(window, 'flowDraws') + 1);
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.locator('.hero canvas[data-living-field]')).toHaveAttribute('data-running', 'true');
  const ratio = await page.evaluate(async () => {
    const before = Reflect.get(window, 'flowDraws');
    for (let i=0;i<50;i++) await new Promise(requestAnimationFrame);
    return (Reflect.get(window, 'flowDraws')-before)/50;
  });
  expect(ratio).toBeGreaterThan(.8);
});

test('everywhere clicks and keyboard activation feed one bounded background response', async ({ page }) => {
  for (const path of ['/', '/visit/', '/my-visit/', '/about/', '/privacy/']) {
    await page.goto(path);
    const field = page.locator('[data-flow-controller]');
    await expect(field).toHaveCount(1);
    await expect(field).toHaveAttribute('aria-hidden', 'true');
    await page.locator('h1').click();
    await expect(field).toHaveAttribute('data-impact', '1');
    await page.locator('h1').evaluate(el => { for(let i=0;i<8;i++) el.dispatchEvent(new MouseEvent('click', { bubbles:true,clientX:80,clientY:280 })); });
    await expect(field).toHaveAttribute('data-impact', '9');
    await page.locator('[data-motion-toggle]').click();
    const scene = page.locator('canvas[data-living-field]').first();
    const paused = await scene.evaluate(el => (el as HTMLCanvasElement).toDataURL());
    await page.locator('h1').click(); await page.waitForTimeout(180);
    expect(await scene.evaluate(el => (el as HTMLCanvasElement).toDataURL())).toBe(paused);
    await expect(field).toHaveAttribute('data-running', 'false');
    await page.locator('[data-motion-toggle]').click();
  }
});

test('navigation carries background phase and input momentum through native page transitions', async ({ page }) => {
  await page.addInitScript(() => {
    addEventListener('pageswap', () => {
      const detail: {state?: unknown} = {};
      document.dispatchEvent(new CustomEvent('createch:flow-capture', {detail}));
      sessionStorage.setItem('flow-test-outgoing', JSON.stringify(detail.state ?? null));
    });
  });
  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.locator('.hero a[href="/visit/"]').click();
  await expect(page).toHaveURL(/\/visit\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-flow-restored', 'true');
  const state = await page.evaluate(() => {
    const detail: {state?: {phase:number}} = {};
    document.dispatchEvent(new CustomEvent('createch:flow-capture', {detail}));
    return {now:detail.state, previous:JSON.parse(sessionStorage.getItem('flow-test-outgoing') || 'null')};
  });
  expect(state.previous.phase).toBeGreaterThan(.8);
  expect(state.now!.phase).toBeGreaterThanOrEqual(state.previous.phase);
  expect(state.now!.phase-state.previous.phase).toBeLessThan(1);
  await page.goBack();
  await expect(page).toHaveURL(/:4352\/$/);
  await expect(page.locator('[data-flow-controller]')).toHaveAttribute('data-running', 'true');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('[data-flow-controller]')).toHaveAttribute('data-running', 'false');
});
