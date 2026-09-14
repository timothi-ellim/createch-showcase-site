-- Administrative additions; upgrades preserve all existing drafts and receipts.
create function public.record_event_config(p_expected_version bigint,p_config jsonb,p_themes jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint; begin
 perform editorial.require_organiser();
 perform 1 from editorial.settings for update;
 if coalesce((select max(version) from editorial.event_configs),0)<>p_expected_version then raise exception 'EVENT_CONFIG_CONFLICT'; end if;
 if jsonb_typeof(p_config)<>'object' or jsonb_typeof(p_themes)<>'array' then raise exception 'INVALID_EVENT_CONFIG'; end if;
 insert into editorial.event_configs(config,themes,actor) values(p_config,p_themes,auth.uid()) returning version into v;
 update editorial.settings set policy_version=policy_version+1;
 return v;
end $$;
create function public.revoke_asset(p_asset uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 update editorial.assets set revoked=true where id=p_asset;
 update editorial.settings set policy_version=policy_version+1;
 perform editorial.audit_action('asset_permission_revoked',p_asset);
end $$;
create function public.register_reviewed_source(p_commit text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 if not exists(select 1 from editorial.event_roles where user_id=auth.uid() and active and role='owner') then raise exception 'OWNER_REQUIRED'; end if;
 insert into editorial.reviewed_sources(commit_sha) values(p_commit) on conflict do nothing;
end $$;
create function public.worker_reconcile() returns jsonb language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; n integer:=0; begin
 perform editorial.require_worker();
 for j in select * from editorial.jobs where status='running' and lease_until<now() order by created_at limit 10 for update skip locked loop
  if j.kind='publish' then
   update editorial.jobs set status='recovery_required',error_code='LEASE_EXPIRED_RECONCILE_PROVIDER' where id=j.id;
   update editorial.releases set status='recovery_required' where id=j.subject_id;
   -- The activation lock survives. A stopped run/provider check is required.
  else
   update editorial.jobs set status='failed',error_code='VALIDATION_LEASE_EXPIRED' where id=j.id;
  end if;
  n:=n+1;
 end loop;
 return jsonb_build_object('reconciled',n);
end $$;
create function public.worker_recovery_unlock(p_job uuid,p_attempt uuid,p_receipt jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j editorial.jobs; begin
 perform editorial.require_worker();
 perform 1 from editorial.settings for update;
 select * into j from editorial.jobs where id=p_job for update;
 if j.status is distinct from 'recovery_required' or j.attempt_id is distinct from p_attempt or p_receipt->>'runStopped' is distinct from 'true' or p_receipt->>'providerChecked' is distinct from 'true' or length(coalesce(p_receipt->>'ownerRecoveryReference',''))<3 then raise exception 'RECOVERY_EVIDENCE_REQUIRED'; end if;
 insert into editorial.release_attempts(release_id,attempt_id,state,receipt) values(j.subject_id,p_attempt,'owner_reconciled',p_receipt);
 update editorial.jobs set status='failed',error_code='OWNER_RECONCILED_PREPARE_NEW_RELEASE' where id=p_job;
 update editorial.settings set activation_job=null where activation_job=p_job;
end $$;
create function public.worker_cleanup_inventory() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_worker();
 -- Dry-run only: never removes Storage metadata/bytes. Retention is owner-set.
 return (select coalesce(jsonb_agg(jsonb_build_object('assetId',a.id,'path',a.path,'createdAt',a.created_at)),'[]') from editorial.assets a where a.expires_at<now()-interval '30 days' and not exists(select 1 from editorial.revision_assets where asset_id=a.id) and not exists(select 1 from editorial.drafts where fields->>'assetId'=a.id::text));
end $$;
create function public.worker_seed_local(p_event jsonb,p_themes jsonb,p_projects jsonb,p_owner uuid,p_source text) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; pid uuid; begin
 perform editorial.require_worker();
 if not exists(select 1 from editorial.settings where environment='local') or exists(select 1 from editorial.projects) then raise exception 'EMPTY_LOCAL_STORE_REQUIRED'; end if;
 insert into editorial.event_configs(config,themes) values(p_event,p_themes);
 insert into editorial.event_roles values(p_owner,'owner',true);
 insert into editorial.reviewed_sources(commit_sha) values(p_source);
 for item in select * from jsonb_array_elements(p_projects) loop
  if item->>'publicId' !~ '^fixture-' then raise exception 'SYNTHETIC_RECORD_REQUIRED'; end if;
  insert into editorial.projects(public_id,slug) values(item->>'publicId',item->>'slug') returning id into pid;
  insert into editorial.memberships(project_id,user_id) values(pid,(item->>'userId')::uuid);
  insert into editorial.metadata_versions(project_id,version,fields) values(pid,1,item->'metadata');
  insert into editorial.drafts(project_id,fields) values(pid,item->'fields');
 end loop;
end $$;
revoke execute on function public.record_event_config(bigint,jsonb,jsonb),public.revoke_asset(uuid),public.register_reviewed_source(text) from public,anon;
grant execute on function public.record_event_config(bigint,jsonb,jsonb),public.revoke_asset(uuid),public.register_reviewed_source(text) to authenticated;
revoke execute on function public.worker_reconcile(),public.worker_recovery_unlock(uuid,uuid,jsonb),public.worker_cleanup_inventory(),public.worker_seed_local(jsonb,jsonb,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.worker_reconcile(),public.worker_recovery_unlock(uuid,uuid,jsonb),public.worker_cleanup_inventory(),public.worker_seed_local(jsonb,jsonb,jsonb,uuid,text) to service_role;
