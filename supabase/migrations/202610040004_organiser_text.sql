-- Owner-authorised, exact text publication; never impersonates participant consent.
create function public.submit_organiser_text_revision(p_project uuid,p_expected_version bigint,p_metadata_version bigint,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d editorial.drafts; r editorial.revisions; p editorial.projects; jid uuid; f jsonb; k text; begin
 perform editorial.require_organiser();
 if not exists(select 1 from editorial.event_roles where user_id=auth.uid() and active and role='owner') then raise exception 'OWNER_REQUIRED'; end if;
 select * into p from editorial.projects where id=p_project for update;
 if p.id is null or p.withdrawn then raise exception 'PROJECT_UNAVAILABLE'; end if;
 select * into r from editorial.revisions where actor=auth.uid() and request_id=p_request;
 if found then
  if r.project_id<>p_project or r.draft_version<>p_expected_version or r.metadata_version<>p_metadata_version or r.fields->>'termsVersion' is distinct from 'organiser-text-v1' then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('revisionId',r.id,'jobId',(select id from editorial.jobs where kind='validate' and subject_id=r.id));
 end if;
 select * into d from editorial.drafts where project_id=p_project for update;
 if d.version is distinct from p_expected_version then raise exception 'DRAFT_CONFLICT'; end if;
 if p.metadata_version is distinct from p_metadata_version then raise exception 'METADATA_CONFLICT'; end if;
 if d.fields->>'permission'='true' then raise exception 'PARTICIPANT_PERMISSION_PRESENT'; end if;
 perform editorial.check_fields(d.fields);
 foreach k in array array['title','maker','description'] loop
  if coalesce(length(trim(d.fields->>k)),0)=0 then raise exception 'REQUIRED_FIELDS'; end if;
 end loop;
 f:=jsonb_build_object('title',d.fields->>'title','maker',d.fields->>'maker','description',d.fields->>'description','invitation',coalesce(d.fields->>'invitation',''),'visitorAction',coalesce(d.fields->>'visitorAction',''),'encounters',coalesce(d.fields->'encounters','[]'::jsonb),'processNote',coalesce(d.fields->>'processNote',''),'assetId',null,'alt','','credit','','links','[]'::jsonb,'videoUrl',null,'accessProposal','','permission',false,'termsVersion','organiser-text-v1');
 insert into editorial.revisions(project_id,draft_version,metadata_version,fields,actor,request_id) values(p.id,d.version,p.metadata_version,f,auth.uid(),p_request) returning * into r;
 -- Distinct authority terms and the owner's identity; no participant declaration.
 insert into editorial.permission_evidence(revision_id,actor,terms_version) values(r.id,auth.uid(),'organiser-text-v1');
 insert into editorial.jobs(kind,subject_id) values('validate',r.id) returning id into jid;
 perform editorial.audit_action('organiser_text_authorised',r.id);
 return jsonb_build_object('revisionId',r.id,'jobId',jid);
end $$;
revoke execute on function public.submit_organiser_text_revision(uuid,bigint,bigint,uuid) from public,anon;
grant execute on function public.submit_organiser_text_revision(uuid,bigint,bigint,uuid) to authenticated;

-- Read authority independently, preserving existing worker_subject variants.
create function public.worker_revision_authorisation(p_job uuid,p_attempt uuid) returns text language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 j:=editorial.active_job(p_job,p_attempt);
 if j.kind<>'validate' then raise exception 'INVALID_JOB'; end if;
 return (select pe.terms_version from editorial.permission_evidence pe join editorial.revisions r on r.id=pe.revision_id and r.actor=pe.actor where r.id=j.subject_id);
end $$;
revoke execute on function public.worker_revision_authorisation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.worker_revision_authorisation(uuid,uuid) to service_role;
