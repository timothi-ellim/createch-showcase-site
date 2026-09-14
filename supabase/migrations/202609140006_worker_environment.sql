create function public.worker_environment() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_worker();
 return (select jsonb_build_object('environment',environment,'targetId',target_id,'targetOrigin',target_origin) from editorial.settings);
end $$;
revoke execute on function public.worker_environment() from public,anon,authenticated;
grant execute on function public.worker_environment() to service_role;
