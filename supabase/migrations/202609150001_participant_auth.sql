-- Login state stays private. No email code, session or raw network identifier is stored.
create table editorial.auth_attempts (
 key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
 email_hash text not null, network_hash text not null, origin text not null,
 mode text not null check(mode in ('send','existing-code')),
 user_id uuid references auth.users on delete set null,
 kind text check(kind in ('invite','email')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '15 minutes',
 send_state text not null check(send_state in ('sending','accepted','rejected','unknown','none')),
 verify_state text not null default 'ready' check(verify_state in ('ready','verifying','consumed','failed')),
 verify_claim uuid, failures integer not null default 0,
 actor uuid references auth.users on delete set null
);
create table editorial.auth_budgets (
 key text not null, period bigint not null, count integer not null,
 touched_at timestamptz not null default now(), primary key(key,period)
);
create table editorial.auth_last_send (
 email_hash text primary key, sent_at timestamptz not null
);
create table editorial.auth_creation_intents (
 request_id uuid primary key references editorial.provision_requests,
 email text not null unique, actor uuid not null references auth.users,
 expires_at timestamptz not null, consumed_at timestamptz
);
create table editorial.auth_delivery_audit (
 id bigint generated always as identity primary key,
 user_id uuid references auth.users on delete set null,
 actor uuid references auth.users on delete set null,
 outcome text not null, created_at timestamptz not null default now()
);
alter table editorial.auth_attempts enable row level security;
alter table editorial.auth_budgets enable row level security;
alter table editorial.auth_last_send enable row level security;
alter table editorial.auth_creation_intents enable row level security;
alter table editorial.auth_delivery_audit enable row level security;
revoke all on editorial.auth_attempts,editorial.auth_budgets,editorial.auth_last_send,
 editorial.auth_creation_intents,editorial.auth_delivery_audit from public,anon,authenticated;

create function editorial.auth_eligible(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=p_user and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now()) and
 (exists(select 1 from editorial.event_roles where user_id=u.id and active)
 or exists(select 1 from editorial.memberships m join editorial.projects p on p.id=m.project_id where m.user_id=u.id and m.active and not p.withdrawn)))
$$;
-- Returns false rather than raising: denied attempts still consume the budget.
create function editorial.auth_budget(p_key text,p_seconds int,p_limit int) returns boolean language plpgsql set search_path='' as $$
declare n int; begin
 insert into editorial.auth_budgets(key,period,count) values(p_key,floor(extract(epoch from now())/p_seconds)::bigint,1)
 on conflict(key,period) do update set count=editorial.auth_budgets.count+1,touched_at=now() returning count into n;
 return n<=p_limit;
end $$;

create function public.auth_request_reserve(p_key text,p_email text,p_email_hash text,p_network_hash text,p_origin text,p_mode text,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a editorial.auth_attempts; u auth.users; permitted boolean; budget_ok boolean; last_at timestamptz; begin
 perform editorial.require_worker();
 if p_key !~ '^[a-f0-9]{64}$' or p_email_hash !~ '^[a-f0-9]{64}$' or p_network_hash !~ '^[a-f0-9]{64}$'
 or p_mode not in ('send','existing-code') or length(p_email)>254 or length(p_origin)>300 then raise exception 'INVALID_REQUEST'; end if;
 -- Short database-only critical section, never held over an Auth/SMTP call.
 perform 1 from editorial.settings where singleton for update;
 select * into a from editorial.auth_attempts where key_hash=p_key;
 if found then
  if a.email_hash<>p_email_hash or a.origin<>p_origin or a.mode<>p_mode or a.actor is distinct from p_actor then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('action','complete','sendState',a.send_state);
 end if;
 budget_ok:=editorial.auth_budget('request-network:'||p_network_hash,300,30);
 budget_ok:=editorial.auth_budget('request-email:'||p_email_hash,300,30) and budget_ok;
 if not budget_ok then return jsonb_build_object('action','limited','retryAfterSeconds',300); end if;
 select * into u from auth.users where lower(email)=p_email and deleted_at is null;
 permitted:=u.id is not null and editorial.auth_eligible(u.id)
 and (u.email_confirmed_at is not null or u.invited_at is not null);
 if p_mode='send' then
  select sent_at into last_at from editorial.auth_last_send where email_hash=p_email_hash;
  budget_ok:=(last_at is null or last_at<=now()-interval '60 seconds');
  budget_ok:=editorial.auth_budget('send-email:'||p_email_hash,3600,5) and budget_ok;
  if budget_ok then
   insert into editorial.auth_last_send values(p_email_hash,now()) on conflict(email_hash) do update set sent_at=now();
  end if;
 else budget_ok:=true;
 end if;
 insert into editorial.auth_attempts(key_hash,email_hash,network_hash,origin,mode,user_id,kind,send_state,actor)
 values(p_key,p_email_hash,p_network_hash,p_origin,p_mode,case when permitted then u.id end,
 case when permitted then case when u.email_confirmed_at is null then 'invite' else 'email' end end,
 case when p_mode='send' and permitted and budget_ok then 'sending' else 'none' end,p_actor);
 if not permitted or not budget_ok or p_mode='existing-code' then return jsonb_build_object('action','complete'); end if;
 return jsonb_build_object('action','send','userId',u.id,'email',u.email,'kind',case when u.email_confirmed_at is null then 'invite' else 'email' end);
end $$;

create function public.auth_record_send(p_key text,p_outcome text) returns void language plpgsql security definer set search_path='' as $$
declare a editorial.auth_attempts; begin
 perform editorial.require_worker();
 if p_outcome not in ('accepted','rejected','unknown') then raise exception 'INVALID_REQUEST'; end if;
 update editorial.auth_attempts set send_state=p_outcome where key_hash=p_key and send_state='sending' returning * into a;
 if found then insert into editorial.auth_delivery_audit(user_id,actor,outcome) values(a.user_id,a.actor,p_outcome); end if;
end $$;

create function public.auth_verify_claim(p_key text,p_origin text,p_network_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a editorial.auth_attempts; u auth.users; ok boolean; claim uuid:=gen_random_uuid(); begin
 perform editorial.require_worker();
 perform 1 from editorial.settings where singleton for update;
 ok:=editorial.auth_budget('verify-network:'||p_network_hash,300,30);
 if not ok then return jsonb_build_object('action','limited','retryAfterSeconds',300); end if;
 select * into a from editorial.auth_attempts where key_hash=p_key for update;
 if not found or a.origin<>p_origin or a.expires_at<=now() or a.verify_state<>'ready' or a.failures>=5 then return jsonb_build_object('action','denied'); end if;
 ok:=editorial.auth_budget('verify-email:'||a.email_hash,3600,20);
 if not ok then return jsonb_build_object('action','denied'); end if;
 update editorial.auth_attempts set failures=failures+1,verify_state='verifying',verify_claim=claim where key_hash=p_key;
 select * into u from auth.users where id=a.user_id;
 if not editorial.auth_eligible(u.id) or (a.kind='invite' and u.email_confirmed_at is not null) then
  update editorial.auth_attempts set verify_state='failed' where key_hash=p_key;
  return jsonb_build_object('action','denied');
 end if;
 return jsonb_build_object('action','verify','claim',claim,'email',u.email,'userId',u.id,'kind',a.kind,'emailHash',a.email_hash);
end $$;

create function public.auth_verify_finish(p_key text,p_claim uuid,p_user uuid,p_success boolean,p_uncertain boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare a editorial.auth_attempts; allowed boolean; begin
 perform editorial.require_worker();
 select * into a from editorial.auth_attempts where key_hash=p_key for update;
 if not found or a.verify_state<>'verifying' or a.verify_claim is distinct from p_claim then return false; end if;
 allowed:=p_success and a.user_id=p_user and a.expires_at>now() and editorial.auth_eligible(p_user);
 update editorial.auth_attempts set verify_state=case when allowed then 'consumed' when p_uncertain or p_success or failures>=5 then 'failed' else 'ready' end where key_hash=p_key;
 return coalesce(allowed,false);
end $$;

-- Extend the existing owner/organiser reservation with a five-minute creation intent.
create or replace function public.begin_provisioning(p_request uuid,p_project uuid,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 insert into editorial.auth_creation_intents(request_id,email,actor,expires_at) values(p_request,lower(trim(p_email)),auth.uid(),now()+interval '5 minutes');
 return jsonb_build_object('action','create','email',lower(trim(p_email)));
end $$;

create function public.before_participant_created(event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare intent uuid; begin
 update editorial.auth_creation_intents i set consumed_at=now()
 where i.email=lower(event->'user'->>'email') and i.consumed_at is null and i.expires_at>now()
 and exists(select 1 from editorial.event_roles r where r.user_id=i.actor and r.active)
 and exists(select 1 from editorial.provision_requests r where r.id=i.request_id and r.state='creating')
 returning i.request_id into intent;
 if intent is null then return '{"error":{"http_code":403,"message":"Account creation requires an organiser invitation."}}'::jsonb; end if;
 return '{}'::jsonb;
end $$;

create function public.auth_resend_recipient(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 if not editorial.auth_eligible(p_user) then raise exception 'ACCESS_DENIED'; end if;
 return (select jsonb_build_object('userId',id,'email',email,'actor',auth.uid()) from auth.users where id=p_user);
end $$;

create function public.auth_cleanup() returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_worker();
 update editorial.auth_attempts set send_state='unknown' where send_state='sending' and created_at<now()-interval '2 minutes';
 update editorial.auth_attempts set verify_state='failed' where verify_state='verifying' and expires_at<=now();
 delete from editorial.auth_attempts where expires_at<now()-interval '48 hours';
 delete from editorial.auth_budgets where touched_at<now()-interval '48 hours';
 delete from editorial.auth_last_send where sent_at<now()-interval '48 hours';
 delete from editorial.auth_creation_intents where expires_at<now()-interval '48 hours';
 delete from editorial.auth_delivery_audit where created_at<now()-interval '30 days';
end $$;

revoke all on function editorial.auth_eligible(uuid),editorial.auth_budget(text,int,int) from public,anon,authenticated;
revoke all on function public.auth_request_reserve(text,text,text,text,text,text,uuid),public.auth_record_send(text,text),public.auth_verify_claim(text,text,text),public.auth_verify_finish(text,uuid,uuid,boolean,boolean),public.auth_cleanup() from public,anon,authenticated;
grant execute on function public.auth_request_reserve(text,text,text,text,text,text,uuid),public.auth_record_send(text,text),public.auth_verify_claim(text,text,text),public.auth_verify_finish(text,uuid,uuid,boolean,boolean),public.auth_cleanup() to service_role;
revoke all on function public.auth_resend_recipient(uuid) from public,anon;
grant execute on function public.auth_resend_recipient(uuid) to authenticated;
revoke all on function public.before_participant_created(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.before_participant_created(jsonb) to supabase_auth_admin;
