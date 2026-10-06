-- Gmail's campaign budget is deliberately below its account-wide limit.
-- The campaign row serialises admissions and claims; each attempt, including
-- failed/uncertain/retried sends, consumes a durable rolling-day allowance.
create table editorial.reminder_dispatch_log (
 id bigint generated always as identity primary key,
 attempted_at timestamptz not null default now(),
 kind text not null check(kind in ('confirm','week','day'))
);
create index reminder_dispatch_window on editorial.reminder_dispatch_log(attempted_at);
alter table editorial.reminder_dispatch_log enable row level security;
revoke all on editorial.reminder_dispatch_log from public,anon,authenticated;
alter table editorial.reminder_campaign add column week_until timestamptz;
alter table editorial.reminder_campaign add column day_until timestamptz;
-- Existing campaigns have no subscribers when this feature is first released.
update editorial.reminder_campaign set
 week_at=(((event->>'date')::date-8)+(event->>'startTime')::time) at time zone (event->>'timeZone'),
 day_at=(((event->>'date')::date-2)+(event->>'startTime')::time) at time zone (event->>'timeZone'),
 week_until=(((event->>'date')::date-7)+time '23:00') at time zone (event->>'timeZone'),
 day_until=(((event->>'date')::date-1)+time '23:00') at time zone (event->>'timeZone');
alter table editorial.reminder_campaign alter column week_until set not null;
alter table editorial.reminder_campaign alter column day_until set not null;
create or replace function public.reminder_configure(p_event jsonb,p_origin text,p_revision text,p_ready boolean) returns void language plpgsql security definer set search_path='' as $$
declare e jsonb:=editorial.reminder_event(p_event); a timestamptz; b timestamptz; begin
 perform editorial.require_worker();
 if length(e::text)>5000 or p_revision !~ '^[a-f0-9]{64}$' or p_origin !~ '^https://[a-z0-9.-]+$' then
  if not ((select environment='local' from editorial.settings) and p_origin ~ '^http://127\.0\.0\.1:[0-9]+$' and p_revision ~ '^[a-f0-9]{64}$') then raise exception 'INVALID_CAMPAIGN'; end if;
 end if;
 a:=((e->>'date')::date+(e->>'startTime')::time) at time zone (e->>'timeZone');
 b:=((e->>'date')::date+(e->>'endTime')::time) at time zone (e->>'timeZone');
 if a is null or b is null or b<=a or e->>'title' is null or jsonb_typeof(e->'venue')<>'object' then raise exception 'INVALID_CAMPAIGN'; end if;
 if exists(select 1 from editorial.reminder_campaign c where c.event<>e or c.origin<>p_origin) and exists(select 1 from editorial.reminder_subscribers) then raise exception 'CAMPAIGN_CHANGE_REQUIRES_REVIEW'; end if;
 insert into editorial.reminder_campaign(singleton,event,origin,revision,starts_at,ends_at,week_at,day_at,week_until,day_until,ready)
 values(true,e,p_origin,p_revision,a,b,(((e->>'date')::date-8)+(e->>'startTime')::time) at time zone (e->>'timeZone'),(((e->>'date')::date-2)+(e->>'startTime')::time) at time zone (e->>'timeZone'),(((e->>'date')::date-7)+time '23:00') at time zone (e->>'timeZone'),(((e->>'date')::date-1)+time '23:00') at time zone (e->>'timeZone'),p_ready)
 on conflict(singleton) do update set event=excluded.event,origin=excluded.origin,
 revision=case when exists(select 1 from editorial.reminder_subscribers) then editorial.reminder_campaign.revision else excluded.revision end,
 starts_at=excluded.starts_at,ends_at=excluded.ends_at,week_at=excluded.week_at,day_at=excluded.day_at,week_until=excluded.week_until,day_until=excluded.day_until,
 ready=excluded.ready,updated_at=now();
 if not editorial.reminder_current() then raise exception 'VERIFIED_EVENT_REQUIRED'; end if;
end $$;

create or replace function public.reminder_request(p_email text,p_source text,p_nonce text,p_confirm text,p_unsubscribe text) returns text language plpgsql security definer set search_path='' as $$
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
 -- Admit only requests with a bounded confirmation queue and sending budget.
 if (select count(*) from editorial.reminder_dispatch_log where attempted_at>now()-interval '24 hours')
    +(select count(*) from editorial.reminder_outbox where kind='confirm' and status='queued' and expires_at>now())>=300
 or (select count(*) from editorial.reminder_outbox where kind='confirm' and status='queued' and expires_at>now())>=100
 then return 'busy'; end if;
 if ((now() between c.week_at-interval '24 hours' and c.week_until) or (now() between c.day_at-interval '24 hours' and c.day_until)) and
 ((select count(*) from editorial.reminder_dispatch_log where kind='confirm' and attempted_at>now()-interval '24 hours')
    +(select count(*) from editorial.reminder_outbox where kind='confirm' and status='queued' and expires_at>now()))>=50 then return 'busy'; end if;
 if (s.id is null or s.unsubscribed_at is not null) and (select count(*) from editorial.reminder_subscribers where unsubscribed_at is null and suppressed_at is null)>=500 then return 'full'; end if;
 if s.id is null then
  insert into editorial.reminder_subscribers(email,nonce,confirm_digest,unsubscribe_digest,confirm_expires) values(p_email,p_nonce,p_confirm,p_unsubscribe,now()+interval '24 hours') returning * into s;
 else
  update editorial.reminder_subscribers set nonce=p_nonce,confirm_digest=p_confirm,unsubscribe_digest=p_unsubscribe,confirm_expires=now()+interval '24 hours',requested_at=now() where id=s.id returning * into s;
  update editorial.reminder_outbox set status='cancelled' where subscriber_id=s.id and status='queued';
 end if;
 insert into editorial.reminder_outbox(subscriber_id,kind,revision,nonce,due_at,expires_at) values(s.id,'confirm',c.revision,s.nonce,now(),least(now()+interval '1 hour',c.starts_at));
 return 'received';
end $$;

create or replace function public.reminder_token(p_digest text,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s editorial.reminder_subscribers; c editorial.reminder_campaign; begin
 perform editorial.require_worker(); select * into c from editorial.reminder_campaign for update;
 if p_digest !~ '^[a-f0-9]{64}$' or p_action not in ('confirm','unsubscribe','inspect-confirm','inspect-unsubscribe') then raise exception 'INVALID_LINK'; end if;
 select * into s from editorial.reminder_subscribers where (p_action like '%unsubscribe' and unsubscribe_digest=p_digest) or (p_action like '%confirm' and confirm_digest=p_digest) for update;
 if s.id is null then raise exception 'INVALID_LINK'; end if;
 if p_action like '%confirm' and (s.confirm_expires<now() or now()>=c.starts_at or s.suppressed_at is not null) then raise exception 'EXPIRED_LINK'; end if;
 if p_action='confirm' then
  if c.paused or not c.ready or not editorial.reminder_current() then raise exception 'REMINDERS_UNAVAILABLE'; end if;
  update editorial.reminder_subscribers set confirmed_at=case when unsubscribed_at is not null then now() else coalesce(confirmed_at,now()) end,unsubscribed_at=null where id=s.id;
  insert into editorial.reminder_outbox(subscriber_id,kind,revision,nonce,due_at,expires_at)
   select s.id,t.kind,c.revision,'scheduled',greatest(now(),t.at),t.until from (values('week',c.week_at,c.week_until),('day',c.day_at,c.day_until)) t(kind,at,until) where t.until>now()
   on conflict(subscriber_id,kind,revision,nonce) do update set status='queued' where editorial.reminder_outbox.status='cancelled';
 elsif p_action='unsubscribe' then
  update editorial.reminder_subscribers set unsubscribed_at=now(),confirm_expires=now()-interval '1 second' where id=s.id;
  update editorial.reminder_outbox set status='cancelled' where subscriber_id=s.id and status='queued';
 end if;
 return jsonb_build_object('event',c.event,'week',case when c.week_until>now() then c.week_at end,'day',case when c.day_until>now() then c.day_at end);
end $$;

create or replace function public.reminder_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare c editorial.reminder_campaign; j editorial.reminder_outbox; begin
 perform editorial.require_worker(); select * into c from editorial.reminder_campaign for update;
 -- Never automatically resend an interrupted/ambiguous delivery.
 update editorial.reminder_outbox set status='uncertain',error_code='INTERRUPTED_SEND' where status='sending' and claimed_at<now()-interval '5 minutes';
 update editorial.reminder_outbox set status='missed' where status='queued' and expires_at<=now();
 if c.singleton is null or c.paused or not c.ready or not editorial.reminder_current() or now()>=c.starts_at then return null; end if;
 if (select count(*) from editorial.reminder_dispatch_log where attempted_at>now()-interval '24 hours')>=300 then return null; end if;
 select o.* into j from editorial.reminder_outbox o join editorial.reminder_subscribers s on s.id=o.subscriber_id
 where o.status='queued' and o.due_at<=now() and o.expires_at>now() and o.revision=c.revision and s.suppressed_at is null
 and (o.kind<>'confirm' or not ((now() between c.week_at-interval '24 hours' and c.week_until) or (now() between c.day_at-interval '24 hours' and c.day_until)) or (select count(*) from editorial.reminder_dispatch_log where kind='confirm' and attempted_at>now()-interval '24 hours')<50)
 and ((o.kind='confirm' and o.nonce=s.nonce) or (o.kind<>'confirm' and s.confirmed_at is not null and s.unsubscribed_at is null)) order by (o.kind='confirm') desc,o.due_at limit 1 for update of o skip locked;
 if j.id is null then return null; end if;
 update editorial.reminder_outbox set status='sending',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1 where id=j.id returning * into j;
 insert into editorial.reminder_dispatch_log(kind) values(j.kind);
 return jsonb_build_object('id',j.id,'lease',j.lease,'kind',j.kind,'revision',j.revision,'nonce',j.nonce,'email',(select email from editorial.reminder_subscribers where id=j.subscriber_id),'event',c.event,'origin',c.origin);
end $$;

create or replace function public.reminder_stats() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform editorial.require_organiser(); return jsonb_build_object(
 'capacity',500,'dailyLimit',300,'attempted24h',(select count(*) from editorial.reminder_dispatch_log where attempted_at>now()-interval '24 hours'),
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

create or replace function public.reminder_cleanup() returns void language plpgsql security definer set search_path='' as $$
begin perform editorial.require_worker();
 delete from editorial.reminder_dispatch_log where attempted_at<now()-interval '48 hours';
 delete from editorial.reminder_rate_limits where window_start<now()-interval '1 day';
 delete from editorial.reminder_suppressions where received_at<now()-interval '60 days';
 -- Keep suppression effective for the campaign even if an address never confirmed.
 delete from editorial.reminder_subscribers where confirmed_at is null and suppressed_at is null and requested_at<now()-interval '7 days';
 if exists(select 1 from editorial.reminder_campaign where ends_at<now()-interval '30 days') then
  update editorial.reminder_campaign set paused=true,archived_totals=coalesce(archived_totals,jsonb_build_object('confirmed',(select count(*) from editorial.reminder_subscribers where confirmed_at is not null))) where singleton=true;
  delete from editorial.reminder_subscribers;
 end if;
end $$;
