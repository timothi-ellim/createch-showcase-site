import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';

test('homepage room preview and 3D links lead directly into Explore', async ({page,isMobile}) => {
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');
 const home=page.locator('[data-home-map]');
 await expect(home).toBeVisible();
 await home.scrollIntoViewIfNeeded();
 const room=home.locator('.atlas-room-hit[data-room-open="ws10"]');
 if(!isMobile) {
   const url=page.url();
   await room.hover();
   await expect(home.locator('[data-home-room-preview="ws10"]')).toBeVisible();
   expect(page.url()).toBe(url);
   await room.focus();
   await expect(room).toBeFocused();
 }
 const plan=await home.locator('[data-scene-faces]').innerHTML();
 await home.getByRole('button',{name:'3D space',exact:true}).click();
 expect(await home.locator('[data-scene-faces]').innerHTML()).not.toBe(plan);
 await expect(home.getByRole('button',{name:'3D space',exact:true})).toHaveAttribute('aria-pressed','true');
 await room.click();
 await expect(page).toHaveURL(/mode=map&room=ws10&view=3d/);
 await expect(page.locator('[data-room-plan="ws10"]')).toBeVisible();
 await expect(page.getByRole('button',{name:'3D space',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(errors).toEqual([]);
});

test('homepage map remains readable at narrow widths and in both projections',async({page},info)=>{
 await mkdir('docs/evidence/exhibition-map/home',{recursive:true});
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [320,390,768,1440]) {
  await page.setViewportSize({width,height:960});await page.goto('/');
  const home=page.locator('[data-home-map]');
  for(const view of ['2D plan','3D space']) {
   await home.getByRole('button',{name:view,exact:true}).click();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   const problems=await home.locator('[data-atlas-scene]').evaluate(scene=>{
    const bounds=scene.getBoundingClientRect();const labels=[...scene.querySelectorAll('[data-scene-point]')].map(e=>({key:e.getAttribute('data-scene-point'),r:e.getBoundingClientRect()}));const errors:string[]=[];
    labels.forEach((a,i)=>{if(a.r.left<bounds.left || a.r.right>bounds.right || a.r.top<bounds.top || a.r.bottom>bounds.bottom)errors.push('bounds '+a.key);for(const b of labels.slice(i+1))if(a.r.left<b.r.right && b.r.left<a.r.right && a.r.top<b.r.bottom && b.r.top<a.r.bottom)errors.push('overlap '+a.key+'/'+b.key)});return errors;
   });
   expect(problems,`${width} ${view}`).toEqual([]);
   await home.screenshot({path:`docs/evidence/exhibition-map/home/${width}-${view.slice(0,2)}-${info.project.name}.png`});
  }
 }
 expect((await new AxeBuilder({page}).include('[data-home-map]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});

test('homepage map has useful links without JavaScript',async({browser,baseURL})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
 const page=await context.newPage();await page.goto(baseURL!);
 const home=page.locator('[data-home-map]');
 await expect(home.locator('.home-map-nojs')).toBeVisible();
 await expect(home.locator('.home-map-nojs')).toContainText('Entrance on King Street');
 await expect(home.locator('[data-home-map-controls]')).toBeHidden();
 await home.locator('.atlas-fallback-labels [data-room-open="gallery"]').click();
 await expect(page).toHaveURL(/mode=map&room=gallery/);
 await expect(page.locator('#project-results')).toBeVisible();
 await context.close();
});
