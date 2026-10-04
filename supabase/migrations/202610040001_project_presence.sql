-- Additive, independent artist presence workflow. No production backfill.
create table editorial.presence_drafts (
 project_id uuid primary key references editorial.projects,
 version bigint not null, event_version bigint not null references editorial.event_configs,
 selection jsonb not null, updated_by uuid not null references auth.users,
 updated_at timestamptz not null default now()
);
create table editorial.presence_revisions (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
 project_id uuid not null references editorial.projects, draft_version bigint not null,
 event_version bigint not null references editorial.event_configs, schedule_key text not null,
 selection jsonb not null, windows jsonb not null, digest text not null,
 actor uuid not null references auth.users, request_id uuid not null,
 submitted_at timestamptz not null default now(), unique(actor,request_id)
);
create table editorial.presence_decisions (
 id bigint generated always as identity primary key, project_id uuid not null references editorial.projects,
 revision_id uuid not null references editorial.presence_revisions, version bigint not null,
 decision text not null check(decision in ('approved','removed','changes_requested')),
 windows jsonb not null, schedule_key text not null, digest text not null,
 feedback text not null check(length(feedback)<=2000), reason text not null check(length(reason)<=2000),
 confirmed_positive_override boolean not null,
 actor uuid not null references auth.users, request_id uuid not null, request_digest text not null,
 reviewed_at timestamptz not null default now(), unique(project_id,version), unique(actor,request_id)
);
create table editorial.presence_notes (
 decision_id bigint primary key references editorial.presence_decisions,
 note text not null check(length(note)<=4000)
);
create index presence_revisions_project on editorial.presence_revisions(project_id,sequence desc);
create index presence_decisions_project on editorial.presence_decisions(project_id,version desc);

create function editorial.presence_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_PRESENCE_RECORD'; end $$;
do $$ declare n text; begin
 foreach n in array array['presence_drafts','presence_revisions','presence_decisions','presence_notes'] loop
  execute format('alter table editorial.%I enable row level security',n);
  execute format('revoke all on editorial.%I from public,anon,authenticated',n);
  if n<>'presence_drafts' then execute format('create trigger immutable_record before update or delete on editorial.%I for each row execute function editorial.presence_immutable()',n); end if;
 end loop;
end $$;

create function editorial.presence_event(c jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare s int; e int; step int; begin
 if c->>'date' is null or c->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or c->>'startTime' is null or c->>'startTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or c->>'endTime' is null or c->>'endTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or c->>'timeZone' is distinct from 'Europe/London' then raise exception 'INVALID_PRESENCE_EVENT'; end if;
 perform (c->>'date')::date;
 s:=split_part(c->>'startTime',':',1)::int*60+split_part(c->>'startTime',':',2)::int;
 e:=split_part(c->>'endTime',':',1)::int*60+split_part(c->>'endTime',':',2)::int;
 if c ? 'presenceSlotMinutes' and (jsonb_typeof(c->'presenceSlotMinutes')<>'number' or c->>'presenceSlotMinutes' !~ '^[0-9]+$') then raise exception 'INVALID_PRESENCE_EVENT'; end if;
 step:=coalesce((c->>'presenceSlotMinutes')::int,30);
 if step<15 or step>60 or s>=e or (e-s)%step<>0 then raise exception 'INVALID_PRESENCE_EVENT'; end if;
 return jsonb_build_object('start',s,'end',e,'step',step,'key',concat_ws('|',c->>'date',c->>'startTime',c->>'endTime',c->>'timeZone',step::text));
end $$;
create function editorial.presence_windows(c jsonb,selection jsonb,complete boolean default true) returns jsonb language plpgsql immutable set search_path='' as $$
declare ev jsonb:=editorial.presence_event(c); mode text:=selection->>'mode'; result jsonb; n int; begin
 if jsonb_typeof(selection) is distinct from 'object' or (select count(*) from jsonb_object_keys(selection))<>2 or not(selection ?& array['mode','slots']) or mode is null or mode not in ('whole_event','selected_slots','not_attending','unsure') or jsonb_typeof(selection->'slots') is distinct from 'array' then raise exception 'INVALID_PRESENCE'; end if;
 n:=((ev->>'end')::int-(ev->>'start')::int)/(ev->>'step')::int;
 if exists(select 1 from jsonb_array_elements(selection->'slots') x where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]+$') then raise exception 'INVALID_PRESENCE'; end if;
 if exists(select 1 from jsonb_array_elements_text(selection->'slots') x where x::numeric<0 or x::numeric>=n) or (select count(*)<>count(distinct x) from jsonb_array_elements(selection->'slots') x) or (mode<>'selected_slots' and jsonb_array_length(selection->'slots')>0) or (complete and mode='selected_slots' and jsonb_array_length(selection->'slots')=0) then raise exception 'INVALID_PRESENCE'; end if;
 if mode='whole_event' then return jsonb_build_array(jsonb_build_object('start',c->>'startTime','end',c->>'endTime')); end if;
 if mode<>'selected_slots' then return '[]'; end if;
 with slots as (select x::int i from jsonb_array_elements_text(selection->'slots') x),
 grouped as (select i,i-row_number() over(order by i) g from slots),
 ranges as (select (ev->>'start')::int+min(i)*(ev->>'step')::int s,(ev->>'start')::int+(max(i)+1)*(ev->>'step')::int e from grouped group by g)
 select coalesce(jsonb_agg(jsonb_build_object('start',lpad((s/60)::text,2,'0')||':'||lpad((s%60)::text,2,'0'),'end',lpad((e/60)::text,2,'0')||':'||lpad((e%60)::text,2,'0')) order by s),'[]') into result from ranges;
 return result;
end $$;

create function public.save_presence_draft(p_project uuid,p_expected_version bigint,p_event_version bigint,p_selection jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d editorial.presence_drafts; c jsonb; begin
 perform editorial.require_edit(p_project);
 perform 1 from editorial.projects where id=p_project for update;
 select config into c from editorial.event_configs where version=p_event_version;
 if c is null or editorial.presence_event(c)->>'key' is distinct from (select editorial.presence_event(config)->>'key' from editorial.event_configs order by version desc limit 1) then raise exception 'PRESENCE_EVENT_CHANGED'; end if;
 perform editorial.presence_windows(c,p_selection,false);
 select * into d from editorial.presence_drafts where project_id=p_project;
 -- Recover an acknowledged-late save without silently overwriting another editor.
 if d.version=p_expected_version+1 and d.selection=p_selection and d.event_version=p_event_version and d.updated_by=auth.uid() then return jsonb_build_object('version',d.version,'updatedAt',d.updated_at); end if;
 if p_expected_version is null or coalesce(d.version,0)<>p_expected_version then raise exception 'DRAFT_CONFLICT'; end if;
 insert into editorial.presence_drafts(project_id,version,event_version,selection,updated_by) values(p_project,p_expected_version+1,p_event_version,p_selection,auth.uid())
 on conflict(project_id) do update set version=excluded.version,event_version=excluded.event_version,selection=excluded.selection,updated_by=excluded.updated_by,updated_at=now() returning * into d;
 perform editorial.audit_action('presence_saved',p_project);
 return jsonb_build_object('version',d.version,'updatedAt',d.updated_at);
end $$;

create function public.submit_presence(p_project uuid,p_expected_version bigint,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d editorial.presence_drafts; r editorial.presence_revisions; c jsonb; w jsonb; sk text; payload jsonb; begin
 perform editorial.require_edit(p_project);
 perform 1 from editorial.projects where id=p_project for update;
 select * into r from editorial.presence_revisions where actor=auth.uid() and request_id=p_request;
 if found then
  if r.project_id<>p_project or r.draft_version is distinct from p_expected_version then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('revisionId',r.id,'digest',r.digest);
 end if;
 select * into d from editorial.presence_drafts where project_id=p_project;
 if d.project_id is null or d.version is distinct from p_expected_version then raise exception 'DRAFT_CONFLICT'; end if;
 select config into c from editorial.event_configs where version=d.event_version;
 sk:=editorial.presence_event(c)->>'key';
 if sk is distinct from (select editorial.presence_event(config)->>'key' from editorial.event_configs order by version desc limit 1) then raise exception 'PRESENCE_EVENT_CHANGED'; end if;
 w:=editorial.presence_windows(c,d.selection,true);
 payload:=jsonb_build_object('projectId',p_project,'draftVersion',d.version,'eventVersion',d.event_version,'scheduleKey',sk,'selection',d.selection,'windows',w);
 insert into editorial.presence_revisions(project_id,draft_version,event_version,schedule_key,selection,windows,digest,actor,request_id) values(p_project,d.version,d.event_version,sk,d.selection,w,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),auth.uid(),p_request) returning * into r;
 perform editorial.audit_action('presence_submitted',r.id);
 return jsonb_build_object('revisionId',r.id,'digest',r.digest);
end $$;

create function editorial.presence_decision_json(d editorial.presence_decisions) returns jsonb language sql stable set search_path='' as $$
 select case when d.id is null then null else jsonb_build_object('id',d.id,'version',d.version,'revisionId',d.revision_id,'digest',d.digest,'decision',d.decision,'windows',d.windows,'feedback',d.feedback,'reason',d.reason,'reviewedAt',d.reviewed_at,'scheduleKey',d.schedule_key) end
$$;
create function public.get_presence(p_project uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c editorial.event_configs; result jsonb; begin
 perform editorial.require_read(p_project);
 select * into c from editorial.event_configs order by version desc limit 1;
 select jsonb_build_object('projectId',p.id,'title',coalesce(pd.fields->>'title',p.public_id),'maker',coalesce(pd.fields->>'maker',''),'withdrawn',p.withdrawn,
 'event',jsonb_build_object('date',c.config->>'date','dateLabel',c.config->>'dateLabel','startTime',c.config->>'startTime','endTime',c.config->>'endTime','timeZone',c.config->>'timeZone','presenceSlotMinutes',coalesce((c.config->>'presenceSlotMinutes')::int,30)),
 'eventVersion',c.version,'scheduleKey',editorial.presence_event(c.config)->>'key',
 'draft',case when d.project_id is null then null else jsonb_build_object('version',d.version,'eventVersion',d.event_version,'scheduleKey',(select editorial.presence_event(config)->>'key' from editorial.event_configs where version=d.event_version),'selection',d.selection,'updatedAt',d.updated_at) end,
 'latest',case when r.id is null then null else jsonb_build_object('id',r.id,'draftVersion',r.draft_version,'eventVersion',r.event_version,'scheduleKey',r.schedule_key,'selection',r.selection,'windows',r.windows,'digest',r.digest,'submittedAt',r.submitted_at,'decision',editorial.presence_decision_json(dec)) end,
 'decisionVersion',coalesce((select max(version) from editorial.presence_decisions where project_id=p.id),0),
 'approved',editorial.presence_decision_json(approved),
 'live',case when live.item is null then null else jsonb_build_object('windows',coalesce(live.item->'presence'->'windows','[]'),'decisionId',live.item->'presence'->'decisionId','release',live.sequence) end)
 into result from editorial.projects p join editorial.drafts pd on pd.project_id=p.id
 left join editorial.presence_drafts d on d.project_id=p.id
 left join lateral(select * from editorial.presence_revisions where project_id=p.id order by sequence desc limit 1) r on true
 left join lateral(select * from editorial.presence_decisions where revision_id=r.id order by version desc limit 1) dec on true
 left join lateral(select d2.* from editorial.presence_decisions d2 where d2.project_id=p.id and d2.decision in ('approved','removed') and not exists(select 1 from editorial.presence_decisions newer where newer.revision_id=d2.revision_id and newer.version>d2.version) order by d2.version desc limit 1) approved on true
 left join lateral(select item,rel.sequence from editorial.settings s join editorial.releases rel on rel.id=s.live_release and rel.status='verified_live' cross join lateral jsonb_array_elements(rel.manifest->'projects') item where item->>'projectId'=p.id::text) live on true
 where p.id=p_project;
 return result;
end $$;
create function public.get_presence_overview() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 return (select coalesce(jsonb_agg(public.get_presence(id) order by public_id),'[]') from editorial.projects where not withdrawn);
end $$;
create function public.get_presence_review(p_project uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 return public.get_presence(p_project)||jsonb_build_object('reviewHistory',(select coalesce(jsonb_agg(editorial.presence_decision_json(d)||jsonb_build_object('note',coalesce(n.note,''),'confirmedPositiveOverride',d.confirmed_positive_override) order by d.version desc),'[]') from editorial.presence_decisions d left join editorial.presence_notes n on n.decision_id=d.id where d.project_id=p_project));
end $$;

create function public.decide_presence(p_revision uuid,p_digest text,p_expected_version bigint,p_decision text,p_selection jsonb,p_feedback text,p_reason text,p_note text,p_confirmed boolean,p_request uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare r editorial.presence_revisions; d editorial.presence_decisions; c jsonb; w jsonb:='[]'; sk text; v bigint; rd text; pd jsonb; begin
 perform editorial.require_organiser();
 perform 1 from editorial.settings for update;
 select * into r from editorial.presence_revisions where id=p_revision;
 if r.id is null or r.digest is distinct from p_digest then raise exception 'STALE_REVIEW'; end if;
 perform 1 from editorial.projects where id=r.project_id for update;
 rd:=encode(sha256(convert_to(jsonb_build_array(p_revision,p_digest,p_expected_version,p_decision,p_selection,p_feedback,p_reason,p_note,p_confirmed)::text,'UTF8')),'hex');
 select * into d from editorial.presence_decisions where actor=auth.uid() and request_id=p_request;
 if found then
  if d.request_digest<>rd then raise exception 'REQUEST_CONFLICT'; end if;
  return d.version;
 end if;
 select coalesce(max(version),0) into v from editorial.presence_decisions where project_id=r.project_id;
 if p_expected_version is distinct from v or exists(select 1 from editorial.projects where id=r.project_id and withdrawn) or (p_decision<>'removed' and exists(select 1 from editorial.presence_revisions where project_id=r.project_id and sequence>r.sequence)) then raise exception 'STALE_REVIEW'; end if;
 select config into c from editorial.event_configs order by version desc limit 1;
 sk:=editorial.presence_event(c)->>'key';
 if p_decision is null or p_decision not in ('approved','removed','changes_requested') or p_feedback is null or p_reason is null or p_note is null or length(p_feedback)>2000 or length(p_reason)>2000 or length(p_note)>4000 or (p_decision='changes_requested' and length(trim(p_feedback))=0) then raise exception 'INVALID_PRESENCE_DECISION'; end if;
 if p_decision='approved' then
  if r.schedule_key<>sk then raise exception 'PRESENCE_EVENT_CHANGED'; end if;
  w:=editorial.presence_windows(c,coalesce(p_selection,r.selection),true);
  if w<>r.windows and length(trim(p_reason))=0 then raise exception 'PRESENCE_REASON_REQUIRED'; end if;
  if jsonb_array_length(r.windows)=0 and jsonb_array_length(w)>0 and p_confirmed is distinct from true then raise exception 'PRESENCE_CONFIRMATION_REQUIRED'; end if;
 end if;
 if p_decision='removed' and length(trim(p_reason))=0 then raise exception 'PRESENCE_REASON_REQUIRED'; end if;
 pd:=jsonb_build_object('revisionId',r.id,'version',v+1,'decision',p_decision,'windows',w,'scheduleKey',sk,'confirmedPositiveOverride',jsonb_array_length(r.windows)=0 and jsonb_array_length(w)>0 and p_confirmed is true);
 insert into editorial.presence_decisions(project_id,revision_id,version,decision,windows,schedule_key,digest,feedback,reason,confirmed_positive_override,actor,request_id,request_digest) values(r.project_id,r.id,v+1,p_decision,w,sk,encode(sha256(convert_to(pd::text,'UTF8')),'hex'),p_feedback,p_reason,(pd->>'confirmedPositiveOverride')::boolean,auth.uid(),p_request,rd) returning * into d;
 if length(p_note)>0 then insert into editorial.presence_notes values(d.id,p_note); end if;
 perform editorial.audit_action('presence_'||p_decision,r.id);
 return d.version;
end $$;

revoke all on all functions in schema editorial from public,anon,authenticated;
revoke execute on function public.save_presence_draft(uuid,bigint,bigint,jsonb),public.submit_presence(uuid,bigint,uuid),public.get_presence(uuid),public.get_presence_overview(),public.decide_presence(uuid,text,bigint,text,jsonb,text,text,text,boolean,uuid) from public,anon;
grant execute on function public.save_presence_draft(uuid,bigint,bigint,jsonb),public.submit_presence(uuid,bigint,uuid),public.get_presence(uuid),public.get_presence_overview(),public.decide_presence(uuid,text,bigint,text,jsonb,text,text,text,boolean,uuid) to authenticated;
revoke execute on function public.get_presence_review(uuid) from public,anon;
grant execute on function public.get_presence_review(uuid) to authenticated;
