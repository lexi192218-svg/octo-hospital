create table public.staff_profiles (
 id uuid primary key references public.staff on delete cascade default auth.uid(),
 bio text not null default '' check (length(bio)<=1500),
 specialty text not null default '' check (length(specialty)<=120),
 updated_at timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from public,anon,authenticated;
grant select on public.staff_profiles to authenticated;
grant insert (id,bio,specialty),update (bio,specialty) on public.staff_profiles to authenticated;
create policy profile_read on public.staff_profiles for select to authenticated
using ((id=(select auth.uid()) and octo_private.staff_role() is not null) or octo_private.staff_role()='admin');
create policy profile_insert on public.staff_profiles for insert to authenticated
with check (id=(select auth.uid()) and octo_private.staff_role() is not null);
create policy profile_update on public.staff_profiles for update to authenticated
using (id=(select auth.uid()) and octo_private.staff_role() is not null)
with check (id=(select auth.uid()) and octo_private.staff_role() is not null);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('staff-private','staff-private',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy own_staff_file_read on storage.objects for select to authenticated
using (bucket_id='staff-private' and octo_private.staff_role() is not null
 and ((storage.foldername(name))[1]=(select auth.uid())::text or octo_private.staff_role()='admin'));
create policy own_staff_file_add on storage.objects for insert to authenticated
with check (bucket_id='staff-private' and octo_private.staff_role() is not null
 and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy own_staff_file_remove on storage.objects for delete to authenticated
using (bucket_id='staff-private' and octo_private.staff_role() is not null
 and (storage.foldername(name))[1]=(select auth.uid())::text);
