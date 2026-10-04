-- Keep organiser checks and exact versions; target the singleton for hosted safeupdate.
create or replace function public.set_project_exclusion(p_project uuid,p_withdrawn boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 update editorial.projects set withdrawn=p_withdrawn,policy_version=policy_version+1 where id=p_project;
 update editorial.settings set policy_version=policy_version+1 where singleton = true;
 perform editorial.audit_action(case when p_withdrawn then 'withdrawal_requested' else 'withdrawal_lifted' end,p_project);
end $$;

create or replace function public.record_event_config(p_expected_version bigint,p_config jsonb,p_themes jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint; begin
 perform editorial.require_organiser();
 perform 1 from editorial.settings for update;
 if coalesce((select max(version) from editorial.event_configs),0)<>p_expected_version then raise exception 'EVENT_CONFIG_CONFLICT'; end if;
 if jsonb_typeof(p_config)<>'object' or jsonb_typeof(p_themes)<>'array' then raise exception 'INVALID_EVENT_CONFIG'; end if;
 insert into editorial.event_configs(config,themes,actor) values(p_config,p_themes,auth.uid()) returning version into v;
 update editorial.settings set policy_version=policy_version+1 where singleton = true;
 return v;
end $$;
