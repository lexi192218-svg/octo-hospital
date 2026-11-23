create table public.appointments (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.patients,
 starts_at timestamptz not null,
 clinic text not null check (clinic in ('General outpatient','Maternity','Surgery','Diagnostics')),
 status text not null default 'Booked' check (status in ('Booked','Arrived','Cancelled')),
 unique(patient_id,starts_at)
);
create table public.beds (
 id uuid primary key default gen_random_uuid(),
 ward text not null check (length(trim(ward)) between 1 and 80),
 label text not null check (length(trim(label)) between 1 and 80),
 unique(ward,label)
);
create table public.admissions (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.patients,
 bed_id uuid not null references public.beds,
 admitted_at timestamptz not null default now(),
 released_at timestamptz check (released_at >= admitted_at)
);
create unique index one_patient_per_bed on public.admissions(bed_id) where released_at is null;
create unique index one_bed_per_patient on public.admissions(patient_id) where released_at is null;

create table public.stock_items (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check (length(trim(name)) between 1 and 120),
 reorder_level integer not null check (reorder_level between 0 and 1000000)
);
create table public.stock_movements (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.stock_items,
 quantity integer not null check (quantity between -1000000 and 1000000 and quantity <> 0),
 reference text not null check (length(trim(reference)) between 1 and 120),
 actor uuid not null default auth.uid(),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(item_id,reference)
);
create function octo_private.check_stock() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.item_id::text,0));
 if coalesce((select sum(quantity) from public.stock_movements where item_id=new.item_id),0)+new.quantity < 0 then
  raise exception 'Insufficient stock';
 end if;
 return new;
end $$;
revoke all on function octo_private.check_stock() from public,anon,authenticated;
create trigger stock_quantity before insert on public.stock_movements for each row execute function octo_private.check_stock();

do $$
declare descriptor text[];
begin
 foreach descriptor slice 1 in array array[
  array['appointments','admin,cashier,nurse,doctor','admin,cashier'],
  array['beds','admin,nurse,doctor,surgeon','admin'],
  array['admissions','admin,nurse,doctor,surgeon','nurse'],
  array['stock_items','admin,pharmacy','pharmacy'],
  array['stock_movements','admin,pharmacy','pharmacy']
 ] loop
  execute format('alter table public.%I enable row level security',descriptor[1]);
  execute format('revoke all on public.%I from public,anon,authenticated',descriptor[1]);
  execute format('grant select on public.%I to authenticated',descriptor[1]);
  execute format('create policy department_read on public.%I for select to authenticated using ((select octo_private.staff_role()) = any(string_to_array(%L,'','')))',descriptor[1],descriptor[2]);
  execute format('create policy department_insert on public.%I for insert to authenticated with check ((select octo_private.staff_role()) = any(string_to_array(%L,'','')))',descriptor[1],descriptor[3]);
 end loop;
end $$;
grant insert(patient_id,starts_at,clinic),update(status) on public.appointments to authenticated;
grant insert(ward,label) on public.beds to authenticated;
grant insert(patient_id,bed_id),update(released_at) on public.admissions to authenticated;
grant insert(name,reorder_level) on public.stock_items to authenticated;
grant insert(item_id,quantity,reference) on public.stock_movements to authenticated;
create policy desk_update on public.appointments for update to authenticated
using ((select octo_private.staff_role()) in ('admin','cashier') and status='Booked')
with check ((select octo_private.staff_role()) in ('admin','cashier') and status in ('Arrived','Cancelled'));
create policy release_bed on public.admissions for update to authenticated
using ((select octo_private.staff_role())='nurse' and released_at is null)
with check ((select octo_private.staff_role())='nurse' and released_at is not null);

create view public.stock_balance with (security_invoker=true) as
select i.id,i.name,i.reorder_level,coalesce(sum(m.quantity),0) as quantity
from public.stock_items i left join public.stock_movements m on m.item_id=i.id
group by i.id,i.name,i.reorder_level;
revoke all on public.stock_balance from public,anon;
grant select on public.stock_balance to authenticated;

create function public.daily_operations(day date)
returns table(visits bigint,urgent_visits bigint,card_payments numeric,pharmacy_payments numeric)
language sql stable set search_path = '' as $$
 with bounds as (select day::timestamp at time zone 'Africa/Lagos' as starts, (day+1)::timestamp at time zone 'Africa/Lagos' as ends)
 select
 (select count(*) from public.visits v,bounds b where v.opened_at>=b.starts and v.opened_at<b.ends),
 (select count(*) from public.visits v,bounds b where urgent and v.opened_at>=b.starts and v.opened_at<b.ends),
 coalesce(sum((e.details->>'amount')::numeric) filter(where e.kind='registration_payment'),0),
 coalesce(sum((e.details->>'amount')::numeric) filter(where e.kind='pharmacy_payment'),0)
 from public.events e,bounds b
 where e.kind in ('registration_payment','pharmacy_payment') and e.recorded_at>=b.starts and e.recorded_at<b.ends
 having (select octo_private.staff_role()) in ('admin','cashier')
$$;
revoke all on function public.daily_operations(date) from public,anon;
grant execute on function public.daily_operations(date) to authenticated;
