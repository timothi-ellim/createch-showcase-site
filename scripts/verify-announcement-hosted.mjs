import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const current=await json(join(process.env.LOCALAPPDATA,'CreaTechShowcase','announcement','current.json'));
const deployment=await json(join(current.folder,'deployment.json'));
const artifact=await json(join(current.folder,'artifact.json'));
const snapshot=await json(join(current.folder,'snapshot.json'));
assert.equal(deployment.canonical,'https://createch-showcase.pages.dev');
assert(/^https:\/\/[a-z0-9]+\.createch-showcase\.pages\.dev$/.test(deployment.url));
assert.equal(deployment.revision,artifact.revision);
const service={'CF-Access-Client-Id':process.env.CF_ACCESS_CLIENT_ID,'CF-Access-Client-Secret':process.env.CF_ACCESS_CLIENT_SECRET};
assert(service['CF-Access-Client-Id']&&service['CF-Access-Client-Secret']);
const observations=[];
const request=async(url,headers={})=>{
  assert([deployment.canonical,deployment.url].includes(new URL(url).origin),'Unexpected origin');
  for(let attempt=0;attempt<3;attempt++) {
    try {return await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});}
    catch(error) {if(attempt===2) {await writeFile(join(current.folder,'verification-progress.json'),JSON.stringify({observations,failedUrl:url,errorCode:error.cause?.code??error.name},null,2));throw new Error(`Hosted request failed: ${url}`,{cause:error});}}
  }
};
for(const origin of [deployment.canonical,deployment.url]) {
  const auth=origin===deployment.url?service:{};
  if(origin===deployment.url) for(const headers of [{},{...service,'CF-Access-Client-Secret':'invalid'}]) {
    const r=await request(origin+'/',headers);assert.equal(r.status,302);assert.equal(new URL(r.headers.get('location')).hostname,'spring-thunder-f8f2.cloudflareaccess.com');
  }
  for(const file of artifact.files.filter(f=>!/^_(headers|redirects)$/.test(f.path)&&!/^(participant|organiser)\//.test(f.path))) {
    const path=file.path==='404.html'?'__not_a_page__/':file.path.replace(/index\.html$/,'');
    for(const fresh of [false,true]) {
      const url=new URL(path,origin+'/');if(fresh)url.searchParams.set('verify',file.sha256.slice(0,12));
      const r=await request(url.href,auth);assert.equal(r.status,file.path==='404.html'?404:200,`${origin}/${path}`);
      assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),file.sha256,`Byte mismatch: ${path}`);
      assert.match(r.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
      observations.push({origin,path,fresh,status:r.status,hashMatches:true});
    }
  }
  for(const path of ['/participant','/participant/login/','/participant/editor/?project=test','/organiser','/organiser/releases/']) {
    const r=await request(origin+path,auth);assert.equal(r.status,302);const target=new URL(r.headers.get('location'));
    assert.equal(target.origin,new URL(snapshot.event.participantWorkspaceUrl).origin);assert(target.pathname.startsWith(path.split('?')[0]));
  }
}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},javaScriptEnabled:false});
  const page=await context.newPage();
  for(const path of ['/','/explore/']) {
    await page.goto(deployment.canonical+path);assert.equal(await page.locator('.participant-roster li').count(),13);
    assert(await page.getByRole('heading',{name:'Savannah Irving',exact:true}).isVisible());
    assert.equal(await page.locator('meta[name="robots"]').count(),0);
  }
  await page.goto(deployment.canonical+'/visit/');assert(await page.getByText('Arrival guidance is coming soon.',{exact:true}).isVisible());
  await page.goto(deployment.canonical+'/');await page.screenshot({path:join(current.folder,'hosted-mobile.png'),fullPage:true});
  const receipt={...deployment,verified:true,verifiedAt:new Date().toISOString(),observations,protectedPreviewNegativeChecks:2,workspaceRedirectChecks:10,noJavaScriptRoster:true};
  await writeFile(join(current.folder,'hosted-verification.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({publicUrl:deployment.canonical,deploymentId:deployment.deploymentId,verified:true,byteChecks:observations.length,participants:13,previewNegativeChecks:2,workspaceRedirectChecks:10}));
} finally {await browser.close();}
