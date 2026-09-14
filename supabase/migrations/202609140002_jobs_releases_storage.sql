create function editorial.release_eligible(r editorial.releases) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(r.policy_version=(select policy_version from editorial.settings)
 and exists(select 1 from editorial.reviewed_sources where commit_sha=r.source_commit and enabled)
 and (r.manifest->>'eventVersion')::bigint=(select max(version) from editorial.event_configs)
 and not exists(
   select 1 from jsonb_array_elements(r.manifest->'projects') item
   left join editorial.projects p on p.id=(item->>'projectId')::uuid
   left join editorial.revisions rev on rev.id=(item->>'revisionId')::uuid and rev.project_id=p.id
   left join editorial.prepared prep on prep.revision_id=rev.id
   left join lateral(select * from editorial.decisions where revision_id=rev.id order by version desc limit 1) d on true
   where p.id is null or p.withdrawn or p.metadata_version<>rev.metadata_version or d.decision is distinct from 'approved' or d.id is distinct from (item->>'decisionId')::bigint or prep.digest is distinct from item->>'digest'
   or exists(select 1 from editorial.revision_assets ra join editorial.assets a on a.id=ra.asset_id where ra.revision_id=rev.id and a.revoked)
 ),false)
$$;
create function public.prepare_release(p_source_commit text,p_revisions uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare selection jsonb; manifest jsonb; config editorial.event_configs; settings editorial.settings; rid uuid:=gen_random_uuid(); md text; begin
 perform editorial.require_organiser();
 select * into settings from editorial.settings for update;
 if not exists(select 1 from editorial.reviewed_sources where commit_sha=p_source_commit and enabled) then raise exception 'REVIEWED_SOURCE_REQUIRED'; end if;
 select * into config from editorial.event_configs order by version desc limit 1;
 if config.version is null or coalesce(cardinality(p_revisions),0)>500 then raise exception 'INVALID_RELEASE'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('projectId',r.project_id,'revisionId',r.id,'digest',pr.digest,'decisionId',d.id,'metadataVersion',r.metadata_version,'snapshot',pr.snapshot,'media',pr.media) order by p.public_id),'[]') into selection
 from editorial.revisions r join editorial.projects p on p.id=r.project_id join editorial.prepared pr on pr.revision_id=r.id
 join lateral(select * from editorial.decisions where revision_id=r.id order by version desc limit 1) d on d.decision='approved'
 where r.id=any(p_revisions) and not p.withdrawn and p.metadata_version=r.metadata_version;
 if jsonb_array_length(selection)<>coalesce(cardinality(p_revisions),0) or (select count(distinct item->>'projectId') from jsonb_array_elements(selection) item)<>jsonb_array_length(selection) then raise exception 'INELIGIBLE_SELECTION'; end if;
 -- Every previously live eligible project must be explicitly selected or excluded.
 if exists(select 1 from editorial.releases prev cross join lateral jsonb_array_elements(prev.manifest->'projects') old join editorial.projects p on p.id=(old->>'projectId')::uuid where prev.id=settings.live_release and not p.withdrawn and not exists(select 1 from jsonb_array_elements(selection) item where item->>'projectId'=old->>'projectId')) then raise exception 'INCOMPLETE_RELEASE'; end if;
 manifest:=jsonb_build_object('schemaVersion',1,'hashVersion','canonical-v1','manifestHashVersion','postgres-jsonb-sha256-v1','releaseId',rid,'sourceCommit',p_source_commit,'environment',settings.environment,'targetOrigin',settings.target_origin,'targetId',settings.target_id,'policyVersion',settings.policy_version,'eventVersion',config.version,'event',config.config,'themes',config.themes,'projects',selection,'excludedProjects',(select coalesce(jsonb_agg(public_id order by public_id),'[]') from editorial.projects where withdrawn),'excludedAssets',(select coalesce(jsonb_agg(id order by id),'[]') from editorial.assets where revoked));
 -- Manifest compare token is deliberately versioned separately from Node public DTO hashes.
 md:=encode(sha256(convert_to(manifest::text,'UTF8')),'hex');
 insert into editorial.releases(id,manifest,digest,policy_version,source_commit,prepared_by) values(rid,manifest,md,settings.policy_version,p_source_commit,auth.uid());
 if not editorial.release_eligible((select r from editorial.releases r where id=rid)) then raise exception 'STALE_RELEASE'; end if;
 perform editorial.audit_action('release_prepared',rid);
 return jsonb_build_object('releaseId',rid,'digest',md,'manifest',manifest);
end $$;
create function public.approve_and_queue_release(p_release uuid,p_digest text) returns uuid language plpgsql security definer set search_path='' as $$
declare r editorial.releases; jid uuid; begin
 perform editorial.require_organiser();
 perform 1 from editorial.settings for update;
 select * into r from editorial.releases where id=p_release for update;
 if r.id is null or r.digest<>p_digest or not editorial.release_eligible(r) then raise exception 'STALE_RELEASE'; end if;
 select id into jid from editorial.jobs where kind='publish' and subject_id=p_release;
 if jid is not null then return jid; end if;
 if r.status<>'prepared' then raise exception 'INVALID_RELEASE_STATE'; end if;
 update editorial.releases set approved_by=auth.uid(),approved_at=now(),status='queued' where id=p_release;
 insert into editorial.jobs(kind,subject_id) values('publish',p_release) returning id into jid;
 perform editorial.audit_action('release_approved',p_release);
 return jid;
end $$;
create function public.get_releases() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not editorial.is_organiser() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'sequence',r.sequence,'digest',r.digest,'manifest',r.manifest,'status',r.status,'jobId',j.id,'errorCode',j.error_code,'live',r.id=s.live_release) order by r.sequence desc),'[]') from editorial.releases r cross join editorial.settings s left join editorial.jobs j on j.kind='publish' and j.subject_id=r.id);
end $$;
create function public.authorise_job_dispatch(p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 select * into j from editorial.jobs where id=p_job;
 if j.kind='validate' then perform editorial.require_read((select project_id from editorial.revisions where id=j.subject_id));
 elsif j.kind='publish' then perform editorial.require_organiser();
 else raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 return jsonb_build_object('jobId',j.id,'kind',j.kind,'status',j.status);
end $$;
create function public.retry_job(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 perform public.authorise_job_dispatch(p_job);
 select * into j from editorial.jobs where id=p_job for update;
 if j.status<>'failed' or j.attempts>=3 then raise exception 'RETRY_NOT_AVAILABLE'; end if;
 if j.kind='publish' and (exists(select 1 from editorial.settings where activation_job is not null) or not editorial.release_eligible((select r from editorial.releases r where id=j.subject_id))) then raise exception 'RECOVERY_REVIEW_REQUIRED'; end if;
 update editorial.jobs set status='queued',error_code=null where id=p_job;
 if j.kind='publish' then update editorial.releases set status='queued' where id=j.subject_id; end if;
end $$;
create function public.worker_claim(p_job uuid,p_run text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; attempt uuid:=gen_random_uuid(); begin
 perform editorial.require_worker();
 if length(p_run)>120 then raise exception 'INVALID_RUN'; end if;
 perform 1 from editorial.settings for update;
 select * into j from editorial.jobs where id=p_job for update;
 if j.status is distinct from 'queued' or j.attempts>=3 then return null; end if;
 if j.kind='publish' then
   if exists(select 1 from editorial.settings where activation_job is not null) then return null; end if;
   if not editorial.release_eligible((select r from editorial.releases r where id=j.subject_id and approved_by is not null)) then raise exception 'STALE_RELEASE'; end if;
   update editorial.settings set activation_job=p_job;
   update editorial.releases set status='building' where id=j.subject_id;
 end if;
 update editorial.jobs set status='running',attempts=attempts+1,attempt_id=attempt,lease_until=now()+interval '10 minutes',run_id=p_run,error_code=null where id=p_job;
 return jsonb_build_object('jobId',p_job,'kind',j.kind,'subjectId',j.subject_id,'attemptId',attempt);
end $$;
create function editorial.active_job(p_job uuid,p_attempt uuid) returns editorial.jobs language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 perform editorial.require_worker();
 select * into j from editorial.jobs where id=p_job for update;
 if j.status is distinct from 'running' or j.attempt_id is distinct from p_attempt or j.lease_until<now() then raise exception 'STALE_ATTEMPT'; end if;
 return j;
end $$;
create function public.worker_heartbeat(p_job uuid,p_attempt uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.active_job(p_job,p_attempt);
 update editorial.jobs set lease_until=now()+interval '10 minutes' where id=p_job;
end $$;
create function public.worker_subject(p_job uuid,p_attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 j:=editorial.active_job(p_job,p_attempt);
 if j.kind='publish' then
   return (select jsonb_build_object('manifest',r.manifest,'digest',r.digest,'approvedAt',r.approved_at,'approvedBy',r.approved_by) from editorial.releases r where id=j.subject_id);
 end if;
 return (select jsonb_build_object('revisionId',r.id,'fields',r.fields,'publicId',p.public_id,'slug',p.slug,'metadata',m.fields,'asset',case when a.id is null then null else jsonb_build_object('id',a.id,'path',a.path,'bytes',a.declared_bytes,'type',a.declared_type) end) from editorial.revisions r join editorial.projects p on p.id=r.project_id join editorial.metadata_versions m on m.project_id=r.project_id and m.version=r.metadata_version left join editorial.revision_assets ra on ra.revision_id=r.id left join editorial.assets a on a.id=ra.asset_id and not a.revoked where r.id=j.subject_id);
end $$;
create function public.worker_prepare(p_job uuid,p_attempt uuid,p_snapshot jsonb,p_digest text,p_media jsonb,p_commit text) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 j:=editorial.active_job(p_job,p_attempt);
 if j.kind<>'validate' or p_snapshot->>'approvedRevision' is not null then raise exception 'INVALID_VALIDATION_RECEIPT'; end if;
 if not exists(select 1 from editorial.revisions r join editorial.projects p on p.id=r.project_id where r.id=j.subject_id and p.public_id=p_snapshot->>'id' and p.slug=p_snapshot->>'slug') then raise exception 'INVALID_VALIDATION_IDENTITY'; end if;
 insert into editorial.prepared(revision_id,snapshot,digest,media,validator_commit) values(j.subject_id,p_snapshot,p_digest,p_media,p_commit);
 update editorial.jobs set status='succeeded',lease_until=null where id=p_job;
end $$;
create function public.worker_activation_check(p_job uuid,p_attempt uuid) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 j:=editorial.active_job(p_job,p_attempt);
 if j.kind<>'publish' or not exists(select 1 from editorial.settings where activation_job=p_job) or not editorial.release_eligible((select r from editorial.releases r where id=j.subject_id)) then raise exception 'STALE_RELEASE'; end if;
end $$;
create function public.worker_record_deployment(p_job uuid,p_attempt uuid,p_receipt jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 perform public.worker_activation_check(p_job,p_attempt);
 j:=(select q from editorial.jobs q where id=p_job);
 insert into editorial.release_attempts(release_id,attempt_id,state,receipt) values(j.subject_id,p_attempt,'deployed_unverified',p_receipt);
 update editorial.releases set status='deployed_unverified' where id=j.subject_id;
end $$;
create function public.worker_verified(p_job uuid,p_attempt uuid,p_manifest_digest text,p_receipt jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; r editorial.releases; begin
 perform public.worker_activation_check(p_job,p_attempt);
 j:=(select q from editorial.jobs q where id=p_job);
 select * into r from editorial.releases where id=j.subject_id;
 if r.digest<>p_manifest_digest or r.status<>'deployed_unverified' or p_receipt->>'origin' is distinct from r.manifest->>'targetOrigin' or p_receipt->>'verified' is distinct from 'true' or p_receipt->>'contentRevision' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_PUBLICATION_RECEIPT'; end if;
 insert into editorial.release_attempts(release_id,attempt_id,state,receipt) values(r.id,p_attempt,'verified_live',p_receipt);
 update editorial.releases set status='verified_live' where id=r.id;
 update editorial.settings set live_release=r.id,activation_job=null;
 update editorial.jobs set status='succeeded',lease_until=null where id=p_job;
end $$;
create function public.worker_fail(p_job uuid,p_attempt uuid,p_code text,p_activation_possible boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; recovery boolean; begin
 j:=editorial.active_job(p_job,p_attempt);
 if p_code !~ '^[A-Z_]{3,80}$' then raise exception 'INVALID_ERROR_CODE'; end if;
 recovery:=p_activation_possible or exists(select 1 from editorial.releases where id=j.subject_id and status='deployed_unverified');
 update editorial.jobs set status=case when recovery then 'recovery_required' else 'failed' end,error_code=p_code,lease_until=null where id=p_job;
 if j.kind='publish' then
   update editorial.releases set status=case when recovery then 'recovery_required' else 'failed' end where id=j.subject_id;
   -- An ambiguous activation keeps its lock. Never steal it on lease expiry.
   if not recovery then update editorial.settings set activation_job=null where activation_job=p_job; end if;
 end if;
end $$;
create function public.worker_queued() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_worker();
 return (select coalesce(jsonb_agg(id),'[]') from (select id from editorial.jobs where status='queued' and attempts<3 order by created_at limit 10) q);
end $$;

-- Allocated immutable paths, private bytes, active membership on every read.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('source-uploads','source-uploads',false,5000000,array['image/png','image/jpeg','image/webp']),
 ('prepared-media','prepared-media',false,5000000,array['image/webp']);
create function public.portal_storage_access(bucket text,obj text,writing boolean) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
   (bucket='source-uploads' and exists(select 1 from editorial.assets a where a.path=obj and not a.revoked and editorial.can_read(a.project_id) and (not writing or (a.uploader=auth.uid() and a.expires_at>now() and exists(select 1 from editorial.settings where editing_open) and exists(select 1 from editorial.projects where id=a.project_id and not withdrawn)))))
   or (bucket='prepared-media' and not writing and exists(select 1 from editorial.prepared pr join editorial.revisions r on r.id=pr.revision_id cross join lateral jsonb_array_elements(pr.media) m where m->>'path'=obj and editorial.can_read(r.project_id) and not exists(select 1 from editorial.revision_assets ra join editorial.assets a on a.id=ra.asset_id where ra.revision_id=r.id and a.revoked)))
 )
$$;
create policy allocated_upload on storage.objects for insert to authenticated with check(public.portal_storage_access(bucket_id,name,true));
create policy authorised_download on storage.objects for select to authenticated using(public.portal_storage_access(bucket_id,name,false));
-- No participant UPDATE/DELETE policy: upsert, overwrite and move are denied.

revoke all on all functions in schema editorial from public,anon,authenticated;
revoke execute on function public.prepare_release(text,uuid[]),public.approve_and_queue_release(uuid,text),public.get_releases(),public.authorise_job_dispatch(uuid),public.retry_job(uuid),public.portal_storage_access(text,text,boolean) from public,anon;
grant execute on function public.prepare_release(text,uuid[]),public.approve_and_queue_release(uuid,text),public.get_releases(),public.authorise_job_dispatch(uuid),public.retry_job(uuid),public.portal_storage_access(text,text,boolean) to authenticated;
revoke execute on function public.worker_claim(uuid,text),public.worker_heartbeat(uuid,uuid),public.worker_subject(uuid,uuid),public.worker_prepare(uuid,uuid,jsonb,text,jsonb,text),public.worker_activation_check(uuid,uuid),public.worker_record_deployment(uuid,uuid,jsonb),public.worker_verified(uuid,uuid,text,jsonb),public.worker_fail(uuid,uuid,text,boolean),public.worker_queued() from public,anon,authenticated;
grant execute on function public.worker_claim(uuid,text),public.worker_heartbeat(uuid,uuid),public.worker_subject(uuid,uuid),public.worker_prepare(uuid,uuid,jsonb,text,jsonb,text),public.worker_activation_check(uuid,uuid),public.worker_record_deployment(uuid,uuid,jsonb),public.worker_verified(uuid,uuid,text,jsonb),public.worker_fail(uuid,uuid,text,boolean),public.worker_queued() to service_role;
