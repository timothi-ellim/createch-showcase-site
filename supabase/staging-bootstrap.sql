-- Run only against the verified audbvodildfpmschwyot staging project.
-- No participant data, user provisioning or publication is performed here.
begin;
do $$
begin
  if exists (
    select 1 from editorial.settings
    where environment <> 'staging'
       or target_id is distinct from 'createch-showcase-staging'
       or target_origin is distinct from 'https://createch-showcase-staging.pages.dev'
  ) then
    raise exception 'STAGING_TARGET_MISMATCH';
  end if;
end $$;
insert into editorial.settings(environment, editing_open, target_id, target_origin)
values ('staging', false, 'createch-showcase-staging', 'https://createch-showcase-staging.pages.dev')
on conflict (singleton) do nothing;
commit;

select environment, editing_open, target_id, target_origin, live_release
from editorial.settings;
