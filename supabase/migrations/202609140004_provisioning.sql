create table editorial.provision_requests (
 id uuid primary key,
 project_id uuid not null references editorial.projects,
 email text not null unique check(length(email)<=254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 actor uuid not null references auth.users,
 state text not null default 'creating' check(state in ('creating','provisioned')),
 user_id uuid references auth.users,
 created_at timestamptz not null default now()
);
alter table editorial.provision_requests enable row level security;
revoke all on editorial.provision_requests from public,anon,authenticated;
create function public.begin_provisioning(p_request uuid,p_project uuid,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r editorial.provision_requests; begin
 perform editorial.require_organiser();
 perform 1 from editorial.projects where id=p_project and not withdrawn for update;
 if not found then raise exception 'PROJECT_UNAVAILABLE'; end if;
 select * into r from editorial.provision_requests where id=p_request;
 if found then
  if r.project_id<>p_project or r.email<>lower(trim(p_email)) then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('action',case when r.state='provisioned' then 'complete' else 'needs_review' end,'userId',r.user_id);
 end if;
 insert into editorial.provision_requests(id,project_id,email,actor) values(p_request,p_project,lower(trim(p_email)),auth.uid());
 return jsonb_build_object('action','create','email',lower(trim(p_email)));
end $$;
create function public.worker_finish_provisioning(p_request uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare r editorial.provision_requests; begin
 perform editorial.require_worker();
 select * into r from editorial.provision_requests where id=p_request for update;
 if r.id is null or r.state<>'creating' then raise exception 'PROVISIONING_STATE_CONFLICT'; end if;
 -- Auth admin response is trusted only through the service path; no browser can bind it.
 insert into editorial.memberships(project_id,user_id) values(r.project_id,p_user);
 update editorial.provision_requests set state='provisioned',user_id=p_user where id=p_request;
 insert into editorial.audit(actor,action,subject) values(r.actor,'account_provisioned',r.project_id);
end $$;
revoke execute on function public.begin_provisioning(uuid,uuid,text) from public,anon;
grant execute on function public.begin_provisioning(uuid,uuid,text) to authenticated;
revoke execute on function public.worker_finish_provisioning(uuid,uuid) from public,anon,authenticated;
grant execute on function public.worker_finish_provisioning(uuid,uuid) to service_role;
