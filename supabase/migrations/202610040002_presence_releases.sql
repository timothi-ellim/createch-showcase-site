-- Keep profile approval checks intact and add exact independent hours bindings.
alter function editorial.release_eligible(editorial.releases) rename to profile_release_eligible;
create function editorial.presence_binding(d editorial.presence_decisions) returns jsonb language sql stable set search_path='' as $$
 select case when d.id is null then null else jsonb_build_object('decisionId',d.id,'revisionId',d.revision_id,'digest',d.digest,'scheduleKey',d.schedule_key,'windows',d.windows) end
$$;
create function editorial.release_eligible(r editorial.releases) returns boolean language plpgsql security definer set search_path='' as $$
declare item jsonb; old jsonb; d editorial.presence_decisions; sk text; begin
 if not editorial.profile_release_eligible(r) then return false; end if;
 if coalesce(r.manifest->>'schemaVersion','') not in ('1','2') then return false; end if;
 sk:=editorial.presence_event(r.manifest->'event')->>'key';
 for item in select value from jsonb_array_elements(r.manifest->'projects') loop
  select live into old from editorial.settings s join editorial.releases rel on rel.id=s.live_release cross join lateral jsonb_array_elements(rel.manifest->'projects') live where live->>'projectId'=item->>'projectId';
  if item->'presence' is null or item->'presence'='null'::jsonb then
   if jsonb_array_length(coalesce(old->'presence'->'windows','[]'))>0 then return false; end if;
  else
   if r.manifest->>'schemaVersion'<>'2' then return false; end if;
   select * into d from editorial.presence_decisions where id=(item->'presence'->>'decisionId')::bigint and project_id=(item->>'projectId')::uuid;
   if d.id is null or d.decision not in ('approved','removed') or d.schedule_key<>sk or editorial.presence_binding(d)<>item->'presence' or exists(select 1 from editorial.presence_decisions newer where newer.revision_id=d.revision_id and newer.version>d.version) then return false; end if;
   -- A release can carry its currently live decision or select the latest eligible
   -- approval/removal. Older decisions must not resurrect superseded public hours.
   if d.id is distinct from (old->'presence'->>'decisionId')::bigint and d.id is distinct from (select candidate.id from editorial.presence_decisions candidate where candidate.project_id=d.project_id and candidate.decision in ('approved','removed') and not exists(select 1 from editorial.presence_decisions newer where newer.revision_id=candidate.revision_id and newer.version>candidate.version) order by candidate.version desc limit 1) then return false; end if;
  end if;
 end loop;
 return true;
end $$;

create function editorial.prepare_presence_release(p_source_commit text,p_revisions uuid[],p_presence jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare selection jsonb; manifest jsonb; config editorial.event_configs; settings editorial.settings; rid uuid:=gen_random_uuid(); md text; chosen jsonb; binding jsonb; previous_entry jsonb; did bigint; presence_decision editorial.presence_decisions; enriched jsonb:='[]'; begin
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
 if exists(select 1 from editorial.releases prev cross join lateral jsonb_array_elements(prev.manifest->'projects') old join editorial.projects p on p.id=(old->>'projectId')::uuid where prev.id=settings.live_release and not p.withdrawn and not exists(select 1 from jsonb_array_elements(selection) item where item->>'projectId'=old->>'projectId')) then raise exception 'INCOMPLETE_RELEASE'; end if;
 if p_presence is not null then
  if jsonb_typeof(p_presence)<>'array' or jsonb_array_length(p_presence)<>jsonb_array_length(selection) then raise exception 'PRESENCE_SELECTION_REQUIRED'; end if;
  if exists(select 1 from jsonb_array_elements(p_presence) x where jsonb_typeof(x)<>'object' or not(x ?& array['projectId','decisionId']) or (select count(*) from jsonb_object_keys(x))<>2) then raise exception 'PRESENCE_SELECTION_REQUIRED'; end if;
  if (select count(distinct x->>'projectId') from jsonb_array_elements(p_presence) x)<>jsonb_array_length(selection) then raise exception 'PRESENCE_SELECTION_REQUIRED'; end if;
 end if;
 for chosen in select value from jsonb_array_elements(selection) loop
  select live into previous_entry from editorial.releases rel cross join lateral jsonb_array_elements(rel.manifest->'projects') live where rel.id=settings.live_release and live->>'projectId'=chosen->>'projectId';
  if p_presence is null then did:=(previous_entry->'presence'->>'decisionId')::bigint;
  else
   if not exists(select 1 from jsonb_array_elements(p_presence) x where x->>'projectId'=chosen->>'projectId') then raise exception 'PRESENCE_SELECTION_REQUIRED'; end if;
   select (x->>'decisionId')::bigint into did from jsonb_array_elements(p_presence) x where x->>'projectId'=chosen->>'projectId';
  end if;
  binding:=null;
  if did is null then
   if jsonb_array_length(coalesce(previous_entry->'presence'->'windows','[]'))>0 then raise exception 'PRESENCE_SELECTION_REQUIRED'; end if;
  else
   select * into presence_decision from editorial.presence_decisions where id=did and project_id=(chosen->>'projectId')::uuid;
   if presence_decision.id is null or presence_decision.decision not in ('approved','removed') or presence_decision.schedule_key is distinct from editorial.presence_event(config.config)->>'key' then raise exception 'PRESENCE_SELECTION_REQUIRED'; end if;
   binding:=editorial.presence_binding(presence_decision);
  end if;
  enriched:=enriched||jsonb_build_array(chosen||jsonb_build_object('presence',binding));
 end loop;
 manifest:=jsonb_build_object('schemaVersion',2,'signageVersion',1,'hashVersion','canonical-v1','manifestHashVersion','postgres-jsonb-sha256-v1','releaseId',rid,'sourceCommit',p_source_commit,'environment',settings.environment,'targetOrigin',settings.target_origin,'targetId',settings.target_id,'policyVersion',settings.policy_version,'eventVersion',config.version,'event',config.config,'themes',config.themes,'projects',enriched,'excludedProjects',(select coalesce(jsonb_agg(public_id order by public_id),'[]') from editorial.projects where withdrawn),'excludedAssets',(select coalesce(jsonb_agg(id order by id),'[]') from editorial.assets where revoked));
 md:=encode(sha256(convert_to(manifest::text,'UTF8')),'hex');
 insert into editorial.releases(id,manifest,digest,policy_version,source_commit,prepared_by) values(rid,manifest,md,settings.policy_version,p_source_commit,auth.uid());
 if not editorial.release_eligible((select r from editorial.releases r where id=rid)) then raise exception 'STALE_RELEASE'; end if;
 perform editorial.audit_action('release_prepared',rid);
 return jsonb_build_object('releaseId',rid,'digest',md,'manifest',manifest);
end $$;
-- Old clients carry the live hours explicitly. They cannot silently remove them.
create or replace function public.get_review_queue() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not editorial.is_organiser() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.id,'projectId',r.project_id,'title',r.fields->>'title','submittedAt',r.submitted_at,'jobStatus',j.status,'errorCode',j.error_code,'ready',pr.revision_id is not null,'decision',dec.decision) order by r.submitted_at desc),'[]') from editorial.revisions r left join editorial.prepared pr on pr.revision_id=r.id left join editorial.jobs j on j.subject_id=r.id and j.kind='validate' left join lateral(select decision from editorial.decisions where revision_id=r.id order by version desc limit 1) dec on true);
end $$;
create or replace function public.prepare_release(p_source_commit text,p_revisions uuid[]) returns jsonb language sql security definer set search_path='' as $$
 select editorial.prepare_presence_release(p_source_commit,p_revisions,null)
$$;
create function public.prepare_presence_release(p_source_commit text,p_revisions uuid[],p_presence jsonb) returns jsonb language sql security definer set search_path='' as $$
 select editorial.prepare_presence_release(p_source_commit,p_revisions,p_presence)
$$;

create function public.get_project_signage(p_project uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r editorial.releases; item jsonb; p editorial.projects; begin
 perform editorial.require_read(p_project);
 select * into p from editorial.projects where id=p_project;
 if p.withdrawn then return jsonb_build_object('status','withdrawal_requested'); end if;
 select rel.* into r from editorial.settings s join editorial.releases rel on rel.id=s.live_release and rel.status='verified_live';
 select value into item from jsonb_array_elements(r.manifest->'projects') where value->>'projectId'=p_project::text;
 if item is null then return jsonb_build_object('status','unpublished'); end if;
 if r.manifest->>'signageVersion' is distinct from '1' then return jsonb_build_object('status','awaiting_assets'); end if;
 return jsonb_build_object('status','available','release',r.sequence,'origin',r.manifest->'event'->>'publicSiteUrl','slug',item->'snapshot'->>'slug','title',item->'snapshot'->>'title','maker',item->'snapshot'->>'maker');
end $$;
create function public.get_signage_catalogue() returns jsonb language plpgsql security definer set search_path='' as $$
declare r editorial.releases; pending boolean; items jsonb; begin
 perform editorial.require_organiser();
 select rel.* into r from editorial.settings s join editorial.releases rel on rel.id=s.live_release and rel.status='verified_live';
 if r.id is null then return jsonb_build_object('status','unpublished','projects','[]'::jsonb); end if;
 select exists(select 1 from jsonb_array_elements(r.manifest->'projects') item join editorial.projects p on p.id=(item->>'projectId')::uuid where p.withdrawn) into pending;
 select coalesce(jsonb_agg(public.get_project_signage(p.id) order by p.public_id),'[]') into items from jsonb_array_elements(r.manifest->'projects') item join editorial.projects p on p.id=(item->>'projectId')::uuid where not p.withdrawn;
 return jsonb_build_object('status',case when pending then 'withdrawal_pending' when r.manifest->>'signageVersion' is distinct from '1' then 'awaiting_assets' else 'available' end,'release',r.sequence,'origin',r.manifest->'event'->>'publicSiteUrl','projects',items);
end $$;
revoke execute on function public.prepare_presence_release(text,uuid[],jsonb),public.get_project_signage(uuid),public.get_signage_catalogue() from public,anon;
grant execute on function public.prepare_presence_release(text,uuid[],jsonb),public.get_project_signage(uuid),public.get_signage_catalogue() to authenticated;
revoke all on all functions in schema editorial from public,anon,authenticated;
