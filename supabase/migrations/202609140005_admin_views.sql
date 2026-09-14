-- Read-only administrative context; protected roles are checked in PostgreSQL.
create function public.get_event_administration() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform editorial.require_organiser();
 return jsonb_build_object(
  'event',(select jsonb_build_object('version',version,'config',config,'themes',themes) from editorial.event_configs order by version desc limit 1),
  'roles',(select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'role',role,'active',active)),'[]') from editorial.event_roles),
  'assets',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'project',p.public_id,'revoked',a.revoked)),'[]') from editorial.assets a join editorial.projects p on p.id=a.project_id)
 );
end $$;
revoke execute on function public.get_event_administration() from public,anon;
grant execute on function public.get_event_administration() to authenticated;
