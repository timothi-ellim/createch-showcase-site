// Local review only. This never edits the snapshot or supplies release approval.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readSnapshot, digest } from '../src/lib/content-schema.ts';
import { writeMediaDerivatives } from '../editorial/media-derivatives.ts';
import { searchTitle } from '../src/lib/discovery.ts';
import { escapeHtml } from '../src/lib/project-renderer.ts';
const args=process.argv.slice(2);
const param=name=>args[args.indexOf(name)+1];
if(!args.includes('--snapshot')) throw Error('Supply --snapshot with an approved public snapshot.');
const snapshot=readSnapshot(JSON.parse(await readFile(resolve(param('--snapshot')),'utf8')));
assert.equal(snapshot.publicationStatus,'approved-public');
const origin=snapshot.event.publicSiteUrl;
assert(origin);
const markerResponse=await fetch(new URL('/content-revision.json',origin),{cache:'no-store'});
assert.equal(markerResponse.status,200);
const marker=await markerResponse.json();
assert.equal(marker.revision,snapshot.revision,'Live content changed; refresh the public baseline.');
const root=resolve('.build-candidates/sharing-preview'), output=resolve(root,'site');
await mkdir(root,{recursive:true});
const snapshotPath=resolve(root,'snapshot.json');
await writeFile(snapshotPath,JSON.stringify(snapshot,null,2));
const env={...process.env,PATH:dirname(process.execPath)+(process.platform==='win32'?';':':')+process.env.PATH,CREATECH_SNAPSHOT:snapshotPath,CREATECH_BUILD_DIR:output,PUBLIC_REMINDERS_ENABLED:'false',PUBLIC_REMINDERS_PREVIEW:'false',ASTRO_TELEMETRY_DISABLED:'1'};
for(const key of ['CREATECH_RELEASE_APPROVAL','CREATECH_REMINDERS_LAUNCH_RECEIPT','CREATECH_REMINDERS_LAUNCH_RECEIPT_JSON'])delete env[key];
const result=spawnSync(process.execPath,['node_modules/astro/bin/astro.mjs','build','--mode','exhibition-preview'],{env,stdio:'inherit',windowsHide:true});
if(result.status!==0)process.exit(result.status||1);
const media=new Set(snapshot.projects.flatMap(p=>[p.media,...p.processMedia].filter(Boolean).map(m=>m.src)));
for(const src of media){
 const hash=src.match(/^\/media\/([a-f0-9]{64})\.[a-z0-9]+$/)?.[1]; assert(hash);
 const res=await fetch(new URL(src,origin));assert.equal(res.status,200);
 const bytes=Buffer.from(await res.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
 const target=resolve(output,'.'+src);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);await writeMediaDerivatives(bytes,hash,output);
}
const reviewPages=[['/','Homepage'],['/explore/','Explore the showcase'],['/visit/','Plan your visit'],['/about/','About the showcase'],['/programme/','Programme'],['/poster/','Event poster']];
const comparisons=[];
for(const [route,label] of reviewPages){
 const res=await fetch(new URL(route,origin),{cache:'no-store'});assert.equal(res.status,200);
 const html=await res.text();const previous=html.match(/<title>(.*?)<\/title>/)?.[1];
 comparisons.push({route,label,previous,proposed:searchTitle(snapshot.event,route)});
}
await mkdir(resolve(output,'review'),{recursive:true});
await writeFile(resolve(output,'review/index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Discovery and sharing — local review</title><link rel="stylesheet" href="/review/review.css"><main><p class="eyebrow">LOCAL REVIEW · NOT PUBLISHED</p><h1>Help people find<br>and share the showcase.</h1><p class="intro">Review the search titles, sharing actions and downloadable pack. All 12 participant records are unchanged.</p><nav><a href="/sharing/">Open the sharing pack ↗</a><a href="/">View homepage ↗</a><a href="/projects/social-xr/">View project sharing ↗</a></nav><section><h2>Search titles</h2><p>These are proposed page titles, not live Google results. Search engines may display different wording.</p>${comparisons.map(p=>`<article><a href="${p.route}">${escapeHtml(p.label)}</a><p class="before">Current: ${p.previous}</p><p class="after">${escapeHtml(p.proposed)}</p></article>`).join('')}</section><section><h2>Indexing check</h2><p>Google Analytics ownership verification is complete. Search Console was still processing its indexing report at the last check. The public crawlability audit below is separate from Google indexing status.</p><p>The public crawlability report is saved with the project evidence. An accessible page or a sitemap does not prove Google has indexed it.</p><p>This local preview stays on this computer and is marked noindex. The live website has not changed.</p></section></main></html>`);
await writeFile(resolve(output,'review/review.css'),`*{box-sizing:border-box}body{margin:0;background:#f7f4ee;color:#201932;font-family:Arial,sans-serif}main{max-width:1060px;margin:auto;padding:60px 24px}.eyebrow{font-size:12px;letter-spacing:2px}h1{font-size:clamp(40px,6vw,72px);line-height:1.04;letter-spacing:-2px;color:#3214f5}.intro{font-size:21px;max-width:55ch;line-height:1.6}nav{display:flex;flex-wrap:wrap;gap:12px;margin:32px 0 60px}nav a{background:#3214f5;color:#fff;padding:16px 20px;border-radius:30px;text-decoration:none}section{margin-top:52px}h2{font-size:32px}p{line-height:1.65}article{background:#fff;border:1px solid #d4ccd9;padding:24px;margin:16px 0;border-radius:12px;overflow-wrap:anywhere}article>a{font-weight:bold;color:#3214f5}.before{color:#635c6f;font-size:14px}.after{font-size:23px;color:#3214f5;margin-bottom:0}a:focus-visible{outline:3px solid #aa7010;outline-offset:5px}`);
await writeFile(resolve(root,'build-evidence.json'),JSON.stringify({mode:'exhibition-preview',revision:snapshot.revision,participantContentHash:digest(snapshot.projects),participantsUnchanged:true,eventUnchanged:true,projects:snapshot.projects.length,approvedMedia:media.size,titles:comparisons,reminderSignupEnabled:false,published:false,output},null,2));
console.log('Local review: http://127.0.0.1:4342/review/');
if(!args.includes('--build-only')){
 const server=spawn(process.execPath,['node_modules/astro/bin/astro.mjs','preview','--mode','exhibition-preview','--host','127.0.0.1','--port','4342'],{env:{...env,ASTRO_PREVIEW_BACKGROUND:'1'},stdio:'inherit',windowsHide:true});
 server.on('exit',code=>process.exit(code||0));
}
