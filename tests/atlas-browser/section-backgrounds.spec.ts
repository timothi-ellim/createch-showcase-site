import { test, expect } from '@playwright/test';

test('section decoration stays clipped behind foreground and clears reading zones', async ({page}) => {
  for(const path of ['/', '/explore/', '/visit/', '/my-visit/']) {
    await page.goto(path);
    await page.waitForTimeout(450);
    await page.locator('h1').click();
    await page.waitForTimeout(90);
    const result=await page.evaluate(()=>{
      let samples=0,painted=0;const violations:string[]=[];
      const layers=[...document.querySelectorAll<HTMLElement>('.section-atmosphere')];
      const order=layers.every(el=>getComputedStyle(el).zIndex==='-1'&&getComputedStyle(el).overflow==='hidden'&&getComputedStyle(el).pointerEvents==='none');
      for(const layer of layers){
        const canvas=layer.querySelector('canvas')!,r=canvas.getBoundingClientRect();
        if(!r.width||!r.height||r.bottom<0||r.top>innerHeight)continue;
        const ctx=canvas.getContext('2d')!,sx=canvas.width/r.width,sy=canvas.height/r.height;
        for(const el of layer.parentElement!.querySelectorAll('h1,h2,p,button,input,img,.exhibition-window,.reading-panel')){
          const range=document.createRange();range.selectNodeContents(el);
          const b=el.matches('h1,h2,p')?range.getBoundingClientRect():el.getBoundingClientRect();
          if(!b.width||!b.height||b.top<r.top||b.bottom>r.bottom||b.left<r.left||b.right>r.right)continue;
          const x=Math.max(0,Math.floor((b.left-r.left)*sx)),y=Math.max(0,Math.floor((b.top-r.top)*sy));
          const w=Math.min(canvas.width-x,Math.floor(b.width*sx)),h=Math.min(canvas.height-y,Math.floor(b.height*sy));
          if(w<1||h<1)continue;
          const before=painted;
          const pixels=ctx.getImageData(x,y,w,h).data;
          for(let i=3;i<pixels.length;i+=4){samples++;if(pixels[i])painted++;}
          if(painted>before)violations.push(el.tagName+'.'+el.className+':'+(painted-before));
        }
      }
      return {order,samples,painted,violations,overlay:!!document.querySelector('canvas[data-flow-field],.physical-waves')};
    });
    expect(result.order).toBe(true);expect(result.overlay).toBe(false);
    expect(result.samples).toBeGreaterThan(100);expect(result.painted,JSON.stringify({path,violations:result.violations})).toBe(0);
  }
});
