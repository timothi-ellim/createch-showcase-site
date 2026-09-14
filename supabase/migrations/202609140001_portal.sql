-- Browser access is RPC-only. The private schema is not exposed by PostgREST.
create schema if not exists editorial;
revoke all on schema editorial from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema editorial revoke all on tables from public, anon, authenticated;
alter default privileges in schema editorial revoke execute on functions from public;

create table editorial.settings (
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in ('local','staging','production')),
  policy_version bigint not null default 1,
  editing_open boolean not null default true,
  target_origin text, target_id text,
  live_release uuid,
  activation_job uuid
);
create table editorial.event_configs (
  version bigint generated always as identity primary key,
  config jsonb not null,
  themes jsonb not null,
  created_at timestamptz not null default now(),
  actor uuid references auth.users
);
create table editorial.event_roles (
  user_id uuid primary key references auth.users,
  role text not null check(role in ('owner','organiser')),
  active boolean not null default true
);
create table editorial.projects (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique check(public_id ~ '^[a-z][a-z0-9-]{1,79}$'),
  slug text not null unique check(slug ~ '^[a-z][a-z0-9-]{1,79}$'),
  withdrawn boolean not null default false,
  policy_version bigint not null default 1,
  metadata_version bigint not null default 1
);
create table editorial.memberships (
  project_id uuid references editorial.projects,
  user_id uuid references auth.users,
  active boolean not null default true,
  changed_at timestamptz not null default now(),
  primary key(project_id,user_id)
);
create index memberships_user on editorial.memberships(user_id,active);
create table editorial.metadata_versions (
  project_id uuid references editorial.projects,
  version bigint not null,
  fields jsonb not null,
  actor uuid references auth.users,
  created_at timestamptz not null default now(),
  primary key(project_id,version)
);
create table editorial.drafts (
  project_id uuid primary key references editorial.projects,
  version bigint not null default 0,
  fields jsonb not null default '{}',
  updated_by uuid references auth.users,
  updated_at timestamptz not null default now()
);
create table editorial.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references editorial.projects,
  path text not null unique,
  declared_type text not null check(declared_type in ('image/png','image/jpeg','image/webp')),
  declared_bytes integer not null check(declared_bytes between 12 and 5000000),
  uploader uuid not null references auth.users,
  expires_at timestamptz not null default now()+interval '1 hour',
  created_at timestamptz not null default now(),
  revoked boolean not null default false,
  unique(project_id,id)
);
create table editorial.revisions (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  project_id uuid not null references editorial.projects,
  draft_version bigint not null,
  metadata_version bigint not null,
  fields jsonb not null,
  actor uuid not null references auth.users,
  submitted_at timestamptz not null default now(),
  request_id uuid not null,
  unique(project_id,id), unique(actor,request_id),
  foreign key(project_id,metadata_version) references editorial.metadata_versions
);
create index revisions_project_time on editorial.revisions(project_id,submitted_at desc);
create table editorial.revision_assets (
  project_id uuid not null,
  revision_id uuid not null,
  asset_id uuid not null,
  primary key(revision_id,asset_id),
  foreign key(project_id,revision_id) references editorial.revisions(project_id,id),
  foreign key(project_id,asset_id) references editorial.assets(project_id,id)
);
create table editorial.permission_evidence (
  revision_id uuid primary key references editorial.revisions,
  actor uuid not null references auth.users,
  terms_version text not null,
  declared_at timestamptz not null default now()
);
create table editorial.prepared (
  revision_id uuid primary key references editorial.revisions,
  snapshot jsonb not null,
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  media jsonb not null default '[]',
  validator_commit text not null check(validator_commit ~ '^[a-f0-9]{40}$'),
  hash_version text not null default 'canonical-v1',
  created_at timestamptz not null default now()
);
create table editorial.decisions (
  id bigint generated always as identity primary key,
  revision_id uuid not null references editorial.prepared,
  digest text not null,
  version bigint not null,
  decision text not null check(decision in ('approved','changes_requested','revoked')),
  feedback text not null default '' check(length(feedback)<=2000),
  actor uuid not null references auth.users,
  created_at timestamptz not null default now(),
  unique(revision_id,version)
);
create table editorial.review_notes (
  decision_id bigint primary key references editorial.decisions,
  note text not null check(length(note)<=4000)
);
create table editorial.reviewed_sources (
  commit_sha text primary key check(commit_sha ~ '^[a-f0-9]{40}$'),
  enabled boolean not null default true,
  reviewed_at timestamptz not null default now()
);
create table editorial.releases (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  manifest jsonb not null,
  digest text not null,
  policy_version bigint not null,
  source_commit text not null references editorial.reviewed_sources,
  prepared_by uuid not null references auth.users,
  prepared_at timestamptz not null default now(),
  approved_by uuid references auth.users,
  approved_at timestamptz,
  status text not null default 'prepared' check(status in ('prepared','queued','building','deployed_unverified','verified_live','failed','recovery_required'))
);
create table editorial.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('validate','publish')),
  subject_id uuid not null,
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','recovery_required')),
  attempts integer not null default 0,
  attempt_id uuid,
  lease_until timestamptz,
  run_id text,
  error_code text,
  created_at timestamptz not null default now(),
  unique(kind,subject_id)
);
create index jobs_eligible on editorial.jobs(status,created_at);
create table editorial.release_attempts (
  id bigint generated always as identity primary key,
  release_id uuid not null references editorial.releases,
  attempt_id uuid not null,
  state text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
create table editorial.audit (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  subject uuid,
  created_at timestamptz not null default now()
);

-- Defence in depth: no browser grants, no permissive table policies.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='editorial' loop
    execute format('alter table editorial.%I enable row level security',t.tablename);
    execute format('revoke all on editorial.%I from anon, authenticated',t.tablename);
  end loop;
end $$;

create function editorial.is_organiser() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from editorial.event_roles where user_id=auth.uid() and active)
$$;
create function editorial.can_read(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (editorial.is_organiser() or exists(select 1 from editorial.memberships where project_id=p and user_id=auth.uid() and active))
$$;
create function editorial.require_read(p uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not editorial.can_read(p) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if; end $$;
create function editorial.require_edit(p uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_read(p);
 if not exists(select 1 from editorial.settings where editing_open) or not exists(select 1 from editorial.projects where id=p and not withdrawn) then raise exception 'EDITING_CLOSED'; end if;
end $$;
create function editorial.require_organiser() returns void language plpgsql security definer set search_path='' as $$
begin
 if not editorial.is_organiser() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 if auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED' using errcode='42501'; end if;
end $$;
create function editorial.require_worker() returns void language plpgsql security definer set search_path='' as $$
begin if auth.role() is distinct from 'service_role' then raise exception 'WORKER_REQUIRED' using errcode='42501'; end if; end $$;
create function editorial.audit_action(a text,s uuid) returns void language sql security definer set search_path='' as $$
 insert into editorial.audit(actor,action,subject) values(auth.uid(),a,s)
$$;

create function editorial.check_fields(f jsonb, complete boolean default false) returns void language plpgsql set search_path='' as $$
declare k text; lim int; begin
 if jsonb_typeof(f) is distinct from 'object' or octet_length(f::text)>24000 then raise exception 'INVALID_FIELDS'; end if;
 for k in select jsonb_object_keys(f) loop
   if not k=any(array['title','maker','invitation','description','visitorAction','encounters','assetId','alt','credit','links','videoUrl','processNote','accessProposal','permission','termsVersion']) then raise exception 'UNEXPECTED_FIELD'; end if;
 end loop;
 for k,lim in select * from (values ('title',120),('maker',100),('invitation',200),('description',2000),('visitorAction',700),('alt',300),('credit',200),('processNote',800),('accessProposal',700)) as limits(k,lim) loop
   if f ? k and (jsonb_typeof(f->k) <> 'string' or length(f->>k)>lim or (f->>k) ~ '[<>]') then raise exception 'INVALID_TEXT_FIELD'; end if;
 end loop;
 if f ? 'encounters' and (jsonb_typeof(f->'encounters')<>'array' or jsonb_array_length(f->'encounters')>2 or not (f->'encounters') <@ '["Look / listen","Participate"]'::jsonb) then raise exception 'INVALID_ENCOUNTERS'; end if;
 if f ? 'links' and (jsonb_typeof(f->'links')<>'array' or jsonb_array_length(f->'links')>3) then raise exception 'INVALID_LINKS'; end if;
 if f ? 'permission' and jsonb_typeof(f->'permission')<>'boolean' then raise exception 'INVALID_PERMISSION'; end if;
 if f ? 'assetId' and jsonb_typeof(f->'assetId') not in ('string','null') then raise exception 'INVALID_ASSET'; end if;
 if complete then
   foreach k in array array['title','maker','invitation','description','visitorAction'] loop
     if coalesce(length(trim(f->>k)),0)=0 then raise exception 'REQUIRED_FIELDS'; end if;
   end loop;
   if coalesce(jsonb_array_length(f->'encounters'),0)=0 or f->>'permission' is distinct from 'true' or f->>'termsVersion' is distinct from 'public-profile-v1' then raise exception 'PERMISSION_AND_ENCOUNTERS_REQUIRED'; end if;
   if f->>'assetId' is not null and (coalesce(length(trim(f->>'alt')),0)=0 or coalesce(length(trim(f->>'credit')),0)=0) then raise exception 'IMAGE_TEXT_REQUIRED'; end if;
 end if;
end $$;

create function public.portal_context() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 return jsonb_build_object('organiser',editorial.is_organiser(),'owner',exists(select 1 from editorial.event_roles where user_id=auth.uid() and active and role='owner'),'editingOpen',(select editing_open from editorial.settings),'environment',(select environment from editorial.settings),'event',(select config from editorial.event_configs order by version desc limit 1),'sources',case when editorial.is_organiser() then (select coalesce(jsonb_agg(commit_sha),'[]') from editorial.reviewed_sources where enabled) else '[]'::jsonb end);
end $$;
create function public.get_my_projects() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'publicId',p.public_id,'slug',p.slug,'withdrawn',p.withdrawn,'title',coalesce(d.fields->>'title','Untitled project'),'draftVersion',d.version,'latestRevision',r.id,'status',coalesce(dec.decision,j.status,'draft'),'feedback',coalesce(dec.feedback,''),'liveRevision',live.item->>'revisionId') order by p.public_id),'[]')
 from editorial.projects p join editorial.drafts d on d.project_id=p.id
 left join lateral(select id from editorial.revisions where project_id=p.id order by sequence desc limit 1) r on true
 left join editorial.jobs j on j.subject_id=r.id and j.kind='validate'
 left join lateral(select decision,feedback from editorial.decisions where revision_id=r.id order by version desc limit 1) dec on true
 left join lateral(select item from editorial.settings s join editorial.releases rel on rel.id=s.live_release cross join lateral jsonb_array_elements(rel.manifest->'projects') item where item->>'projectId'=p.id::text) live on true
 where editorial.can_read(p.id)
$$;
create function public.get_project_draft(p_project uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 perform editorial.require_read(p_project);
 select jsonb_build_object('projectId',p.id,'publicId',p.public_id,'slug',p.slug,'version',d.version,'fields',d.fields,'metadata',m.fields,'metadataVersion',m.version,'updatedAt',d.updated_at) into result from editorial.projects p join editorial.drafts d on d.project_id=p.id join editorial.metadata_versions m on m.project_id=p.id and m.version=p.metadata_version where p.id=p_project;
 return result;
end $$;
create function public.save_project_draft(p_project uuid,p_expected_version bigint,p_fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d editorial.drafts; begin
 perform editorial.require_edit(p_project);
 perform editorial.check_fields(p_fields);
 select * into d from editorial.drafts where project_id=p_project for update;
 if d.version<>p_expected_version then raise exception 'DRAFT_CONFLICT'; end if;
 if p_fields->>'assetId' is not null and not exists(select 1 from editorial.assets where id=(p_fields->>'assetId')::uuid and project_id=p_project and not revoked) then raise exception 'INVALID_ASSET'; end if;
 update editorial.drafts set fields=p_fields,version=version+1,updated_by=auth.uid(),updated_at=now() where project_id=p_project returning * into d;
 perform editorial.audit_action('draft_saved',p_project);
 return jsonb_build_object('version',d.version,'updatedAt',d.updated_at);
end $$;
create function public.reserve_upload(p_project uuid,p_type text,p_bytes integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare aid uuid:=gen_random_uuid(); obj text; begin
 perform editorial.require_edit(p_project);
 perform 1 from editorial.projects where id=p_project for update;
 if (select count(*) from editorial.assets where project_id=p_project and created_at>now()-interval '1 day')>=20 then raise exception 'UPLOAD_LIMIT'; end if;
 obj:=p_project::text||'/'||aid::text;
 insert into editorial.assets(id,project_id,path,declared_type,declared_bytes,uploader) values(aid,p_project,obj,p_type,p_bytes,auth.uid());
 return jsonb_build_object('assetId',aid,'path',obj,'bucket','source-uploads');
end $$;
create function public.submit_project_revision(p_project uuid,p_expected_version bigint,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d editorial.drafts; r editorial.revisions; jid uuid; mv bigint; begin
 perform editorial.require_edit(p_project);
 select metadata_version into mv from editorial.projects where id=p_project for update;
 select * into r from editorial.revisions where actor=auth.uid() and request_id=p_request;
 if found then
   if r.project_id<>p_project or r.draft_version<>p_expected_version then raise exception 'REQUEST_CONFLICT'; end if;
   return jsonb_build_object('revisionId',r.id,'jobId',(select id from editorial.jobs where kind='validate' and subject_id=r.id));
 end if;
 select * into d from editorial.drafts where project_id=p_project for update;
 if d.version<>p_expected_version then raise exception 'DRAFT_CONFLICT'; end if;
 perform editorial.check_fields(d.fields,true);
 insert into editorial.revisions(project_id,draft_version,metadata_version,fields,actor,request_id) values(p_project,d.version,mv,d.fields,auth.uid(),p_request) returning * into r;
 if d.fields->>'assetId' is not null then
   if not exists(select 1 from editorial.assets where id=(d.fields->>'assetId')::uuid and project_id=p_project and not revoked) then raise exception 'INVALID_ASSET'; end if;
   insert into editorial.revision_assets values(p_project,r.id,(d.fields->>'assetId')::uuid);
 end if;
 insert into editorial.permission_evidence(revision_id,actor,terms_version) values(r.id,auth.uid(),d.fields->>'termsVersion');
 insert into editorial.jobs(kind,subject_id) values('validate',r.id) returning id into jid;
 perform editorial.audit_action('revision_submitted',r.id);
 return jsonb_build_object('revisionId',r.id,'jobId',jid);
end $$;
create function public.get_revision_preview(p_revision uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r editorial.revisions; result jsonb; begin
 select * into r from editorial.revisions where id=p_revision;
 perform editorial.require_read(r.project_id);
 select jsonb_build_object('revisionId',r.id,'projectId',r.project_id,'draftVersion',r.draft_version,'metadataVersion',r.metadata_version,'submittedAt',r.submitted_at,'fields',r.fields - 'permission' - 'termsVersion','prepared',pr.snapshot,'digest',pr.digest,'sourceCommit',pr.validator_commit,'media',pr.media,'decisionVersion',coalesce(dec.version,0),'decision',dec.decision,'feedback',dec.feedback,'jobId',j.id,'jobStatus',j.status,'errorCode',j.error_code,'metadata',m.fields,'publicId',p.public_id,'slug',p.slug,'previous',old.item->'snapshot') into result
 from editorial.projects p join editorial.metadata_versions m on m.project_id=p.id and m.version=r.metadata_version
 left join editorial.prepared pr on pr.revision_id=r.id
 left join editorial.jobs j on j.kind='validate' and j.subject_id=r.id
 left join lateral(select version,decision,feedback from editorial.decisions where revision_id=r.id order by version desc limit 1) dec on true
 left join lateral(select item from editorial.settings s join editorial.releases rel on rel.id=s.live_release cross join lateral jsonb_array_elements(rel.manifest->'projects') item where item->>'projectId'=p.id::text) old on true
 where p.id=r.project_id;
 return result;
end $$;
create function public.get_review_queue() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not editorial.is_organiser() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.id,'title',r.fields->>'title','submittedAt',r.submitted_at,'jobStatus',j.status,'errorCode',j.error_code,'ready',pr.revision_id is not null,'decision',dec.decision) order by r.submitted_at desc),'[]') from editorial.revisions r left join editorial.prepared pr on pr.revision_id=r.id left join editorial.jobs j on j.subject_id=r.id and j.kind='validate' left join lateral(select decision from editorial.decisions where revision_id=r.id order by version desc limit 1) dec on true);
end $$;
create function public.decide_revision(p_revision uuid,p_digest text,p_expected_version bigint,p_decision text,p_feedback text default '',p_note text default '') returns bigint language plpgsql security definer set search_path='' as $$
declare r editorial.revisions; pr editorial.prepared; v bigint; did bigint; begin
 perform editorial.require_organiser();
 select * into r from editorial.revisions where id=p_revision;
 perform 1 from editorial.projects where id=r.project_id for update;
 select * into pr from editorial.prepared where revision_id=p_revision;
 if pr.revision_id is null or pr.digest<>p_digest then raise exception 'PREPARED_VERSION_REQUIRED'; end if;
 if not exists(select 1 from editorial.projects where id=r.project_id and metadata_version=r.metadata_version and not withdrawn) or exists(select 1 from editorial.revisions where project_id=r.project_id and sequence>r.sequence) then raise exception 'STALE_REVIEW'; end if;
 if exists(select 1 from editorial.revision_assets ra join editorial.assets a on a.id=ra.asset_id where ra.revision_id=p_revision and a.revoked) then raise exception 'ASSET_REVOKED'; end if;
 select coalesce(max(version),0) into v from editorial.decisions where revision_id=p_revision;
 if v<>p_expected_version then raise exception 'STALE_REVIEW'; end if;
 if p_decision not in ('approved','changes_requested','revoked') or (p_decision='changes_requested' and length(trim(p_feedback))=0) then raise exception 'INVALID_DECISION'; end if;
 insert into editorial.decisions(revision_id,digest,version,decision,feedback,actor) values(p_revision,p_digest,v+1,p_decision,p_feedback,auth.uid()) returning id into did;
 if length(p_note)>0 then insert into editorial.review_notes values(did,p_note); end if;
 perform editorial.audit_action('review_'||p_decision,p_revision);
 return v+1;
end $$;

create function public.update_project_metadata(p_project uuid,p_expected_version bigint,p_fields jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint; k text; begin
 perform editorial.require_organiser();
 select metadata_version into v from editorial.projects where id=p_project for update;
 if v is null or v<>p_expected_version then raise exception 'METADATA_CONFLICT'; end if;
 for k in select jsonb_object_keys(p_fields) loop if k not in ('theme','room','duration','schedule','accessNotes','relatedIds') then raise exception 'UNEXPECTED_FIELD'; end if; end loop;
 if p_fields->>'theme' not in ('image','world','relation') then raise exception 'INVALID_THEME'; end if;
 insert into editorial.metadata_versions(project_id,version,fields,actor) values(p_project,v+1,p_fields,auth.uid());
 update editorial.projects set metadata_version=v+1 where id=p_project;
 update editorial.settings set policy_version=policy_version+1;
 perform editorial.audit_action('metadata_changed',p_project);
 return v+1;
end $$;
create function public.set_membership(p_project uuid,p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 insert into editorial.memberships(project_id,user_id,active) values(p_project,p_user,p_active) on conflict(project_id,user_id) do update set active=excluded.active,changed_at=now();
 perform editorial.audit_action(case when p_active then 'member_assigned' else 'member_revoked' end,p_project);
end $$;
create function public.get_people() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 return (select coalesce(jsonb_agg(jsonb_build_object('projectId',m.project_id,'project',p.public_id,'userId',m.user_id,'active',m.active)),'[]') from editorial.memberships m join editorial.projects p on p.id=m.project_id);
end $$;
create function public.set_event_role(p_user uuid,p_role text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 if not exists(select 1 from editorial.event_roles where user_id=auth.uid() and active and role='owner') or p_user=auth.uid() then raise exception 'OWNER_REQUIRED'; end if;
 insert into editorial.event_roles(user_id,role,active) values(p_user,p_role,p_active) on conflict(user_id) do update set role=excluded.role,active=excluded.active;
 perform editorial.audit_action('event_role_changed',p_user);
end $$;
create function public.set_project_exclusion(p_project uuid,p_withdrawn boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 update editorial.projects set withdrawn=p_withdrawn,policy_version=policy_version+1 where id=p_project;
 update editorial.settings set policy_version=policy_version+1;
 perform editorial.audit_action(case when p_withdrawn then 'withdrawal_requested' else 'withdrawal_lifted' end,p_project);
end $$;
create function public.set_editing_open(p_open boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 if not exists(select 1 from editorial.event_roles where user_id=auth.uid() and active and role='owner') then raise exception 'OWNER_REQUIRED'; end if;
 update editorial.settings set editing_open=p_open;
 perform editorial.audit_action('editing_window_changed',null);
end $$;

-- Every callable browser routine checks current roles. No helper is callable.
revoke all on all functions in schema editorial from public,anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.portal_context(),public.get_my_projects(),public.get_project_draft(uuid),public.save_project_draft(uuid,bigint,jsonb),public.reserve_upload(uuid,text,integer),public.submit_project_revision(uuid,bigint,uuid),public.get_revision_preview(uuid),public.get_review_queue(),public.decide_revision(uuid,text,bigint,text,text,text),public.update_project_metadata(uuid,bigint,jsonb),public.set_membership(uuid,uuid,boolean),public.get_people(),public.set_event_role(uuid,text,boolean),public.set_project_exclusion(uuid,boolean),public.set_editing_open(boolean) to authenticated;
