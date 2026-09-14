import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { dispatchHandler } from '../../../editorial/portal-control.ts';
const required=(key:string)=>{const value=Deno.env.get(key);if(!value)throw new Error('CONTROL_CONFIGURATION_REQUIRED');return value;};
const url=required('SUPABASE_URL'),key=required('SUPABASE_ANON_KEY');
Deno.serve(dispatchHandler({
 origin:required('PORTAL_APP_ORIGIN'),
 authenticate:async(authorization)=>{
  const client=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('AUTH_REQUIRED');
  return {rpc:async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw new Error('ACCESS_DENIED');return data;}};
 },
 dispatch:async(jobId)=>{
  const repo=required('CREATECH_GITHUB_REPOSITORY'),workflow=required('CREATECH_GITHUB_WORKFLOW'),ref=required('CREATECH_GITHUB_REF');
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||workflow!=='portal-worker.yml')throw new Error('INVALID_FIXED_TARGET');
  const response=await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${required('CREATECH_GITHUB_TOKEN')}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({ref,inputs:{job_id:jobId}}),signal:AbortSignal.timeout(15000)});
  if(response.status!==204)throw new Error('DISPATCH_FAILED');
 }
}));
