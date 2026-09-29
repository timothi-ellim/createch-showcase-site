-- Scope singleton writes explicitly for hosted safe-update enforcement.
create or replace function public.worker_claim(p_job uuid,p_run text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; attempt uuid:=gen_random_uuid(); begin
 perform editorial.require_worker();
 if length(p_run)>120 then raise exception 'INVALID_RUN'; end if;
 perform 1 from editorial.settings for update;
 select * into j from editorial.jobs where id=p_job for update;
 if j.status is distinct from 'queued' or j.attempts>=3 then return null; end if;
 if j.kind='publish' then
   if exists(select 1 from editorial.settings where activation_job is not null) then return null; end if;
   if not editorial.release_eligible((select r from editorial.releases r where id=j.subject_id and approved_by is not null)) then raise exception 'STALE_RELEASE'; end if;
   update editorial.settings set activation_job=p_job where singleton = true;
   update editorial.releases set status='building' where id=j.subject_id;
 end if;
 update editorial.jobs set status='running',attempts=attempts+1,attempt_id=attempt,lease_until=now()+interval '10 minutes',run_id=p_run,error_code=null where id=p_job;
 return jsonb_build_object('jobId',p_job,'kind',j.kind,'subjectId',j.subject_id,'attemptId',attempt);
end $$;

create or replace function public.worker_verified(p_job uuid,p_attempt uuid,p_manifest_digest text,p_receipt jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; r editorial.releases; begin
 perform public.worker_activation_check(p_job,p_attempt);
 j:=(select q from editorial.jobs q where id=p_job);
 select * into r from editorial.releases where id=j.subject_id;
 if r.digest<>p_manifest_digest or r.status<>'deployed_unverified' or p_receipt->>'origin' is distinct from r.manifest->>'targetOrigin' or p_receipt->>'verified' is distinct from 'true' or p_receipt->>'contentRevision' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_PUBLICATION_RECEIPT'; end if;
 insert into editorial.release_attempts(release_id,attempt_id,state,receipt) values(r.id,p_attempt,'verified_live',p_receipt);
 update editorial.releases set status='verified_live' where id=r.id;
 update editorial.settings set live_release=r.id,activation_job=null where singleton = true;
 update editorial.jobs set status='succeeded',lease_until=null where id=p_job;
end $$;

