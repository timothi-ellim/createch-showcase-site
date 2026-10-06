-- Visitor subscriptions are not Auth users or participant records. All tables
-- stay in the private editorial schema; only narrow RPCs are exposed.
create table editorial.reminder_campaign (
 singleton boolean primary key default true check(singleton),
 event jsonb not null, origin text not null, revision text not null,
 starts_at timestamptz not null, ends_at timestamptz not null,
 week_at timestamptz not null, day_at timestamptz not null,
 paused boolean not null default true, ready boolean not null default false,
 archived_totals jsonb, updated_at timestamptz not null default now()
);
create table editorial.reminder_subscribers (
 id uuid primary key default gen_random_uuid(), email text unique not null,
 created_at timestamptz not null default now(), requested_at timestamptz not null default now(),
 confirmed_at timestamptz, unsubscribed_at timestamptz, suppressed_at timestamptz,
 nonce text not null, confirm_digest text not null, unsubscribe_digest text not null,
 confirm_expires timestamptz not null, consent_version text not null default 'event-reminders-v1'
);
create table editorial.reminder_outbox (
 id uuid primary key default gen_random_uuid(), subscriber_id uuid not null references editorial.reminder_subscribers on delete cascade,
 kind text not null check(kind in ('confirm','week','day')), revision text not null,
 nonce text not null, due_at timestamptz not null, expires_at timestamptz not null,
 status text not null default 'queued' check(status in ('queued','sending','accepted','failed','uncertain','cancelled','missed')),
 lease uuid, claimed_at timestamptz, provider_id text, error_code text, attempts integer not null default 0,
 unique(subscriber_id,kind,revision,nonce)
);
create table editorial.reminder_rate_limits (
 source_digest text primary key, window_start timestamptz not null, requests integer not null
);
create table editorial.reminder_suppressions (provider_id text primary key, reason text not null, received_at timestamptz not null default now());
alter table editorial.reminder_suppressions enable row level security;
revoke all on editorial.reminder_suppressions from public,anon,authenticated;
alter table editorial.reminder_campaign enable row level security;
alter table editorial.reminder_subscribers enable row level security;
alter table editorial.reminder_outbox enable row level security;
alter table editorial.reminder_rate_limits enable row level security;
revoke all on editorial.reminder_campaign,editorial.reminder_subscribers,editorial.reminder_outbox,editorial.reminder_rate_limits from public,anon,authenticated;

create function editorial.reminder_event(e jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('title',e->'title','series',e->'series','date',e->'date','startTime',e->'startTime','endTime',e->'endTime','timeZone',e->'timeZone','venue',e->'venue')
$$;
create function editorial.reminder_current() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select s.environment='local' or (r.status='verified_live' and editorial.reminder_event(r.manifest->'event')=c.event and r.manifest->>'targetOrigin'=c.origin)
 from editorial.reminder_campaign c cross join editorial.settings s left join editorial.releases r on r.id=s.live_release),false)
$$;
create function public.reminder_configure(p_event jsonb,p_origin text,p_revision text,p_ready boolean) returns void language plpgsql security definer set search_path='' as $$
declare e jsonb:=editorial.reminder_event(p_event); a timestamptz; b timestamptz; begin
 perform editorial.require_worker();
 if length(e::text)>5000 or p_revision !~ '^[a-f0-9]{64}$' or p_origin !~ '^https://[a-z0-9.-]+$' then
  if not ((select environment='local' from editorial.settings) and p_origin ~ '^http://127\.0\.0\.1:[0-9]+$' and p_revision ~ '^[a-f0-9]{64}$') then raise exception 'INVALID_CAMPAIGN'; end if;
 end if;
 a:=((e->>'date')::date+(e->>'startTime')::time) at time zone (e->>'timeZone');
 b:=((e->>'date')::date+(e->>'endTime')::time) at time zone (e->>'timeZone');
 if a is null or b is null or b<=a or e->>'title' is null or jsonb_typeof(e->'venue')<>'object' then raise exception 'INVALID_CAMPAIGN'; end if;
 if exists(select 1 from editorial.reminder_campaign c where c.event<>e or c.origin<>p_origin) and exists(select 1 from editorial.reminder_subscribers) then raise exception 'CAMPAIGN_CHANGE_REQUIRES_REVIEW'; end if;
 insert into editorial.reminder_campaign(singleton,event,origin,revision,starts_at,ends_at,week_at,day_at,ready)
 values(true,e,p_origin,p_revision,a,b,(((e->>'date')::date-7)+(e->>'startTime')::time) at time zone (e->>'timeZone'),(((e->>'date')::date-1)+(e->>'startTime')::time) at time zone (e->>'timeZone'),p_ready)
 on conflict(singleton) do update set event=excluded.event,origin=excluded.origin,
 revision=case when exists(select 1 from editorial.reminder_subscribers) then editorial.reminder_campaign.revision else excluded.revision end,
 starts_at=excluded.starts_at,ends_at=excluded.ends_at,week_at=excluded.week_at,day_at=excluded.day_at,
 ready=excluded.ready,updated_at=now();
 if not editorial.reminder_current() then raise exception 'VERIFIED_EVENT_REQUIRED'; end if;
end $$;
create function public.reminder_config() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform editorial.require_worker(); return (select jsonb_build_object('event',event,'origin',origin,'revision',revision,'paused',paused,'ready',ready,'current',editorial.reminder_current(),'start',starts_at,'week',week_at,'day',day_at) from editorial.reminder_campaign); end $$;

create function public.reminder_request(p_email text,p_source text,p_nonce text,p_confirm text,p_unsubscribe text) returns text language plpgsql security definer set search_path='' as $$
declare c editorial.reminder_campaign; s editorial.reminder_subscribers; hits integer; begin
 perform editorial.require_worker();
 select * into c from editorial.reminder_campaign for update;
 if c.singleton is null or c.paused or not c.ready or not editorial.reminder_current() then raise exception 'REMINDERS_UNAVAILABLE'; end if;
 if now()>=c.starts_at then raise exception 'REMINDERS_CLOSED'; end if;
 if length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_source !~ '^[a-f0-9]{64}$' or p_confirm !~ '^[a-f0-9]{64}$' or p_unsubscribe !~ '^[a-f0-9]{64}$' or p_nonce !~ '^[a-f0-9]{32}$' then raise exception 'INVALID_REMINDER_REQUEST'; end if;
 insert into editorial.reminder_rate_limits values(p_source,now(),1)
 on conflict(source_digest) do update set window_start=case when editorial.reminder_rate_limits.window_start<now()-interval '1 hour' then now() else editorial.reminder_rate_limits.window_start end,
 requests=case when editorial.reminder_rate_limits.window_start<now()-interval '1 hour' then 1 else editorial.reminder_rate_limits.requests+1 end returning requests into hits;
 if hits>12 then return 'limited'; end if;
 select * into s from editorial.reminder_subscribers where email=p_email for update;
 if s.id is not null and (s.suppressed_at is not null or (s.confirmed_at is not null and s.unsubscribed_at is null) or s.requested_at>now()-interval '2 minutes') then return 'received'; end if;
 if s.id is null then
  insert into editorial.reminder_subscribers(email,nonce,confirm_digest,unsubscribe_digest,confirm_expires) values(p_email,p_nonce,p_confirm,p_unsubscribe,now()+interval '24 hours') returning * into s;
 else
  update editorial.reminder_subscribers set nonce=p_nonce,confirm_digest=p_confirm,unsubscribe_digest=p_unsubscribe,confirm_expires=now()+interval '24 hours',requested_at=now() where id=s.id returning * into s;
  update editorial.reminder_outbox set status='cancelled' where subscriber_id=s.id and status='queued';
 end if;
 insert into editorial.reminder_outbox(subscriber_id,kind,revision,nonce,due_at,expires_at) values(s.id,'confirm',c.revision,s.nonce,now(),least(now()+interval '1 hour',c.starts_at));
 return 'received';
end $$;

create function public.reminder_token(p_digest text,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s editorial.reminder_subscribers; c editorial.reminder_campaign; begin
 perform editorial.require_worker(); select * into c from editorial.reminder_campaign;
 if p_digest !~ '^[a-f0-9]{64}$' or p_action not in ('confirm','unsubscribe','inspect-confirm','inspect-unsubscribe') then raise exception 'INVALID_LINK'; end if;
 select * into s from editorial.reminder_subscribers where (p_action like '%unsubscribe' and unsubscribe_digest=p_digest) or (p_action like '%confirm' and confirm_digest=p_digest) for update;
 if s.id is null then raise exception 'INVALID_LINK'; end if;
 if p_action like '%confirm' and (s.confirm_expires<now() or now()>=c.starts_at or s.suppressed_at is not null) then raise exception 'EXPIRED_LINK'; end if;
 if p_action='confirm' then
  if c.paused or not c.ready or not editorial.reminder_current() then raise exception 'REMINDERS_UNAVAILABLE'; end if;
  update editorial.reminder_subscribers set confirmed_at=case when unsubscribed_at is not null then now() else coalesce(confirmed_at,now()) end,unsubscribed_at=null where id=s.id;
  insert into editorial.reminder_outbox(subscriber_id,kind,revision,nonce,due_at,expires_at)
   select s.id,t.kind,c.revision,'scheduled',t.at,t.at+interval '1 hour' from (values('week',c.week_at),('day',c.day_at)) t(kind,at) where t.at>now()
   on conflict(subscriber_id,kind,revision,nonce) do update set status='queued' where editorial.reminder_outbox.status='cancelled';
 elsif p_action='unsubscribe' then
  update editorial.reminder_subscribers set unsubscribed_at=now(),confirm_expires=now()-interval '1 second' where id=s.id;
  update editorial.reminder_outbox set status='cancelled' where subscriber_id=s.id and status='queued';
 end if;
 return jsonb_build_object('event',c.event,'week',case when c.week_at>now() then c.week_at end,'day',case when c.day_at>now() then c.day_at end);
end $$;

create function public.reminder_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare c editorial.reminder_campaign; j editorial.reminder_outbox; begin
 perform editorial.require_worker(); select * into c from editorial.reminder_campaign for update;
 -- Never automatically resend an interrupted/ambiguous delivery.
 update editorial.reminder_outbox set status='uncertain',error_code='INTERRUPTED_SEND' where status='sending' and claimed_at<now()-interval '5 minutes';
 update editorial.reminder_outbox set status='missed' where status='queued' and expires_at<=now();
 if c.singleton is null or c.paused or not c.ready or not editorial.reminder_current() or now()>=c.starts_at then return null; end if;
 select o.* into j from editorial.reminder_outbox o join editorial.reminder_subscribers s on s.id=o.subscriber_id
 where o.status='queued' and o.due_at<=now() and o.expires_at>now() and o.revision=c.revision and s.suppressed_at is null
 and ((o.kind='confirm' and o.nonce=s.nonce) or (o.kind<>'confirm' and s.confirmed_at is not null and s.unsubscribed_at is null)) order by o.due_at limit 1 for update of o skip locked;
 if j.id is null then return null; end if;
 update editorial.reminder_outbox set status='sending',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1 where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'lease',j.lease,'kind',j.kind,'revision',j.revision,'nonce',j.nonce,'email',(select email from editorial.reminder_subscribers where id=j.subscriber_id),'event',c.event,'origin',c.origin);
end $$;
create function public.reminder_send_check(p_id uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin perform editorial.require_worker(); return exists(select 1 from editorial.reminder_outbox o join editorial.reminder_subscribers s on s.id=o.subscriber_id cross join editorial.reminder_campaign c
 where o.id=p_id and o.lease=p_lease and o.status='sending' and o.expires_at>now() and now()<c.starts_at and not c.paused and c.ready and editorial.reminder_current() and s.suppressed_at is null and ((o.kind='confirm' and o.nonce=s.nonce and s.confirm_expires>now()) or (o.kind<>'confirm' and s.confirmed_at is not null and s.unsubscribed_at is null))); end $$;
create function public.reminder_receipt(p_id uuid,p_lease uuid,p_status text,p_provider text) returns void language plpgsql security definer set search_path='' as $$
begin perform editorial.require_worker();
 if p_status not in ('accepted','failed','uncertain','cancelled') or length(coalesce(p_provider,''))>200 then raise exception 'INVALID_RECEIPT'; end if;
 update editorial.reminder_outbox set status=p_status,provider_id=p_provider where id=p_id and lease=p_lease and status='sending';
 if not found then raise exception 'STALE_LEASE'; end if;
 if exists(select 1 from editorial.reminder_suppressions where provider_id=p_provider) then
  update editorial.reminder_subscribers set suppressed_at=now() where id=(select subscriber_id from editorial.reminder_outbox where id=p_id);
  update editorial.reminder_outbox set status='cancelled' where status='queued' and subscriber_id=(select subscriber_id from editorial.reminder_outbox where id=p_id);
 end if;
end $$;
create function public.reminder_delivery_status(p_provider text,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin perform editorial.require_worker();
 if p_status not in ('bounced','complained') then raise exception 'INVALID_RECEIPT'; end if;
 if p_provider is null or length(p_provider)>200 then raise exception 'INVALID_RECEIPT'; end if;
 insert into editorial.reminder_suppressions(provider_id,reason) values(p_provider,p_status) on conflict do nothing;
 update editorial.reminder_subscribers set suppressed_at=now() where id in(select subscriber_id from editorial.reminder_outbox where provider_id=p_provider);
 update editorial.reminder_outbox set error_code=upper(p_status) where provider_id=p_provider;
 update editorial.reminder_outbox o set status='cancelled' where status='queued' and exists(select 1 from editorial.reminder_subscribers s where s.id=o.subscriber_id and s.suppressed_at is not null);
end $$;
create function public.reminder_retry(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform editorial.require_organiser();
 update editorial.reminder_outbox set status='queued',lease=null where id=p_id and status='failed' and attempts<3 and expires_at>now();
 if not found then raise exception 'RETRY_UNAVAILABLE'; end if;
 perform editorial.audit_action('reminder_retry',p_id);
end $$;
create function public.reminder_attention() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform editorial.require_organiser(); return (select coalesce(jsonb_agg(x),'[]') from (select id,kind,status,due_at as "dueAt",(status='failed' and attempts<3 and expires_at>now()) as "canRetry" from editorial.reminder_outbox where status in ('failed','uncertain','missed') order by due_at desc limit 20) x); end $$;
create function public.reminder_stats() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform editorial.require_organiser(); return jsonb_build_object(
 'active',(select count(*) from editorial.reminder_subscribers where confirmed_at is not null and unsubscribed_at is null and suppressed_at is null),
 'pending',(select count(*) from editorial.reminder_subscribers where confirmed_at is null and unsubscribed_at is null and suppressed_at is null),
 'recent',(select count(*) from editorial.reminder_subscribers where confirmed_at>now()-interval '7 days'),
 'unsubscribed',(select count(*) from editorial.reminder_subscribers where unsubscribed_at is not null),
 'suppressed',(select count(*) from editorial.reminder_subscribers where suppressed_at is not null),
 'attention',(select count(*) from editorial.reminder_outbox where status in ('failed','uncertain','missed')),
 'accepted',(select count(*) from editorial.reminder_outbox where status='accepted'),
 'next',(select min(due_at) from editorial.reminder_outbox where status='queued' and expires_at>now()),
 'paused',coalesce((select paused from editorial.reminder_campaign),true),
 'ready',coalesce((select ready from editorial.reminder_campaign),false),
 'current',editorial.reminder_current(),'asOf',now()); end $$;
create function public.reminder_pause(p_paused boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform editorial.require_organiser();
 if not p_paused and not exists(select 1 from editorial.reminder_campaign where ready and editorial.reminder_current() and starts_at>now()) then raise exception 'REMINDERS_UNAVAILABLE'; end if;
 update editorial.reminder_campaign set paused=p_paused,updated_at=now() where singleton=true;
 perform editorial.audit_action(case when p_paused then 'reminders_paused' else 'reminders_resumed' end,null);
end $$;
create function public.reminder_cleanup() returns void language plpgsql security definer set search_path='' as $$
begin perform editorial.require_worker();
 delete from editorial.reminder_rate_limits where window_start<now()-interval '1 day';
 delete from editorial.reminder_suppressions where received_at<now()-interval '60 days';
 -- Keep suppression effective for the campaign even if an address never confirmed.
 delete from editorial.reminder_subscribers where confirmed_at is null and suppressed_at is null and requested_at<now()-interval '7 days';
 if exists(select 1 from editorial.reminder_campaign where ends_at<now()-interval '30 days') then
  update editorial.reminder_campaign set paused=true,archived_totals=coalesce(archived_totals,jsonb_build_object('confirmed',(select count(*) from editorial.reminder_subscribers where confirmed_at is not null))) where singleton=true;
  delete from editorial.reminder_subscribers;
 end if;
end $$;

revoke execute on function editorial.reminder_event(jsonb),editorial.reminder_current() from public,anon,authenticated;
revoke execute on function public.reminder_configure(jsonb,text,text,boolean),public.reminder_config(),public.reminder_request(text,text,text,text,text),public.reminder_token(text,text),public.reminder_claim(),public.reminder_send_check(uuid,uuid),public.reminder_receipt(uuid,uuid,text,text),public.reminder_delivery_status(text,text),public.reminder_cleanup() from public,anon,authenticated;
grant execute on function public.reminder_configure(jsonb,text,text,boolean),public.reminder_config(),public.reminder_request(text,text,text,text,text),public.reminder_token(text,text),public.reminder_claim(),public.reminder_send_check(uuid,uuid),public.reminder_receipt(uuid,uuid,text,text),public.reminder_delivery_status(text,text),public.reminder_cleanup() to service_role;
revoke execute on function public.reminder_stats(),public.reminder_pause(boolean),public.reminder_retry(uuid),public.reminder_attention() from public,anon;
grant execute on function public.reminder_stats(),public.reminder_pause(boolean),public.reminder_retry(uuid),public.reminder_attention() to authenticated;
