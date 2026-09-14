-- Owners can initialise private projects without a database console or email.
create table editorial.project_creation_requests (
  request_id uuid primary key,
  actor uuid not null references auth.users,
  project_id uuid not null unique references editorial.projects,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table editorial.project_creation_requests enable row level security;
revoke all on editorial.project_creation_requests from public,anon,authenticated;

create function public.create_project(p_request uuid,p_public_id text,p_title text,p_maker text,p_theme text)
returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid; prior editorial.project_creation_requests; payload jsonb; draft jsonb; begin
  perform editorial.require_organiser();
  if not exists(select 1 from editorial.event_roles where user_id=auth.uid() and active and role='owner') then raise exception 'OWNER_REQUIRED'; end if;
  if p_request is null or p_public_id is null or p_public_id !~ '^[a-z][a-z0-9-]{1,79}$'
    or p_title is null or length(trim(p_title)) not between 1 and 120
    or p_maker is null or length(trim(p_maker)) not between 1 and 100
    or p_theme is null or p_theme not in ('image','world','relation') then raise exception 'INVALID_PROJECT_DETAILS'; end if;
  draft:=jsonb_build_object('title',trim(p_title),'maker',trim(p_maker),'invitation','','description','','visitorAction','','encounters','[]'::jsonb,'links','[]'::jsonb,'assetId',null,'videoUrl',null,'alt','','credit','','accessProposal','','processNote','','permission',false,'termsVersion','public-profile-v1');
  perform editorial.check_fields(draft);
  payload:=jsonb_build_object('publicId',p_public_id,'title',trim(p_title),'maker',trim(p_maker),'theme',p_theme);
  -- Serialise creation/idempotency without changing existing draft or membership data.
  perform 1 from editorial.settings for update;
  select * into prior from editorial.project_creation_requests where request_id=p_request;
  if found then
    if prior.actor<>auth.uid() or prior.payload is distinct from payload then raise exception 'REQUEST_CONFLICT'; end if;
    return prior.project_id;
  end if;
  if exists(select 1 from editorial.projects where public_id=p_public_id or slug=p_public_id) then raise exception 'PROJECT_IDENTIFIER_TAKEN'; end if;
  insert into editorial.projects(public_id,slug) values(p_public_id,p_public_id) returning id into pid;
  insert into editorial.metadata_versions(project_id,version,fields,actor)
    values(pid,1,jsonb_build_object('theme',p_theme,'room',null,'duration',null,'schedule',null,'accessNotes',null,'relatedIds','[]'::jsonb),auth.uid());
  insert into editorial.drafts(project_id,fields,updated_by) values(pid,draft,auth.uid());
  insert into editorial.project_creation_requests(request_id,actor,project_id,payload) values(p_request,auth.uid(),pid,payload);
  perform editorial.audit_action('private_project_created',pid);
  return pid;
end $$;
revoke execute on function public.create_project(uuid,text,text,text,text) from public,anon;
grant execute on function public.create_project(uuid,text,text,text,text) to authenticated;
