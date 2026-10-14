-- All credentials are encrypted by the application before storage. No browser role can read them.
create table public.github_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 github_user_id bigint not null,
 login text not null,
 token_ciphertext text not null,
 expires_at timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table public.github_connections enable row level security;
revoke all on public.github_connections from public,anon,authenticated;
grant select,insert,update,delete on public.github_connections to service_role;

create table public.github_website_links (
 artifact_id uuid primary key,
 workspace_id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 repository_id bigint not null,
 repository_name text not null,
 branch text not null,
 commit_sha text,
 version_number integer,
 updated_at timestamptz not null default now(),
 foreign key(artifact_id,workspace_id) references public.artifacts(id,workspace_id) on delete cascade
);
alter table public.github_website_links enable row level security;
revoke all on public.github_website_links from public,anon,authenticated;
grant select,insert,update,delete on public.github_website_links to service_role;
