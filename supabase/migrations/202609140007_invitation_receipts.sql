-- Distinguish historical account creation from actual provider-accepted invites.
alter table editorial.provision_requests add column invitation_requested boolean not null default false;
create function public.worker_record_invitation(p_request uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_worker();
 update editorial.provision_requests set invitation_requested=true where id=p_request and state='creating';
 if not found then raise exception 'PROVISIONING_STATE_CONFLICT'; end if;
end $$;
create function public.invitation_receipt(p_request uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 return coalesce((select invitation_requested from editorial.provision_requests where id=p_request and state='provisioned'),false);
end $$;
revoke execute on function public.worker_record_invitation(uuid) from public,anon,authenticated;
grant execute on function public.worker_record_invitation(uuid) to service_role;
revoke execute on function public.invitation_receipt(uuid) from public,anon;
grant execute on function public.invitation_receipt(uuid) to authenticated;
