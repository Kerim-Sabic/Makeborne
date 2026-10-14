-- Sales and delivery are separate pipelines.
--   Client (sales):     Lead → Contacted → Conversation → Proposal → Won / Lost
--   Project (delivery): active → in_review → changes_requested → delivered
-- One client can have several projects at different delivery stages.
--
-- This migration only adds the project delivery stage. Everything else in the
-- split (compatible stage validation, review functions, audit, and the client
-- stage transition) is in 20261011190000_crm_transition.sql; the client stage
-- rewrite itself runs after the new app is live (docs/CRM_STAGE_TRANSITION.md).
begin;

alter table public.projects add column if not exists delivery_stage text not null default 'active'
  check (delivery_stage in ('active','in_review','changes_requested','delivered'));
grant update(delivery_stage) on public.projects to authenticated;

commit;
