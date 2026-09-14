-- Synthetic-only local environment marker. No participant emails or records.
-- Project/event fixtures are read from canonical content by portal-local.ts.
insert into editorial.settings(environment) values('local') on conflict do nothing;
