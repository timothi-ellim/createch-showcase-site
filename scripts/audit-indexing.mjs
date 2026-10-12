// Public HTTP evidence only; this does not claim access to search-engine indexes.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
const output=resolve(process.argv[2]||'.build-candidates/sharing-preview/indexing-audit.json');
const origin='https://createch-showcase.pages.dev';
const get=async route=>{const r=await fetch(new URL(route,origin),{cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,route);return {r,text:await r.text()};};
const robots=await get('/robots.txt'), sitemap=await get('/sitemap.xml');
const urls=[...sitemap.text.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
const attribute=(tag,key)=>tag?.match(new RegExp(` ${key}="([^"]*)"`))?.[1];
const pages=[];
for(const url of urls){
 const {r,text}=await get(url);
 const meta=name=>[...text.matchAll(/<meta\b[^>]*>/g)].map(m=>m[0]).find(m=>attribute(m,'name')===name||attribute(m,'property')===name);
 const canonical=attribute(text.match(/<link\b[^>]*rel="canonical"[^>]*>/)?.[0],'href');
 const directives=attribute(meta('robots'),'content');
 assert.equal(canonical,url);assert(!/noindex/i.test((directives||'')+(r.headers.get('x-robots-tag')||'')));
 const image=attribute(meta('og:image'),'content');assert(image?.startsWith(origin+'/'));
 const imageResponse=await fetch(image,{method:'HEAD'});assert.equal(imageResponse.status,200);
 pages.push({url,status:r.status,title:text.match(/<title>(.*?)<\/title>/)?.[1],canonical,robots:directives,headerRobots:r.headers.get('x-robots-tag'),socialImageStatus:imageResponse.status});
}
const home=await get('/');
const event=JSON.parse(home.text.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1]);
assert.equal(event.startDate,'2026-10-28T11:00:00+00:00');assert.equal(event.location.address.addressLocality,'Leicester');
const report={checkedAt:new Date().toISOString(),origin,robots:robots.text,sitemapUrls:urls.length,projectPages:urls.filter(u=>u.includes('/projects/')).length,pages,eventMetadata:{type:event['@type'],startDate:event.startDate,endDate:event.endDate,location:event.location},searchConsole:{status:'not-queried-by-http-audit',evidence:'Search Console reports and submission receipts must be checked separately in the authenticated property.',indexStatus:'not checked',sitemapSubmission:'not checked'},limitations:['HTTP checks are not a Googlebot fetch or proof of indexing.','Social image HTTP availability does not establish third-party preview-cache contents.'],published:false};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({pagesChecked:pages.length,projectPages:report.projectPages,canonicalAndRobotsChecks:'passed',eventMetadata:'passed',socialImageRequests:'passed',searchConsole:report.searchConsole}));
