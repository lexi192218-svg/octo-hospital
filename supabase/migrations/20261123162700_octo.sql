create schema octo_private;
grant usage on schema octo_private to authenticated;

create table public.staff (
 id uuid primary key references auth.users on delete cascade,
 name text not null check (length(trim(name)) between 2 and 120),
 email text not null unique,
 role text not null check (role in ('admin','cashier','nurse','doctor','surgeon','lab','pharmacy')),
 active boolean not null default true
);
create function octo_private.staff_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.staff where id = (select auth.uid()) and active $$;
revoke all on function octo_private.staff_role() from public, anon;
grant execute on function octo_private.staff_role() to authenticated;

create table public.patients (
 id uuid primary key default gen_random_uuid(),
 card bigint generated always as identity unique,
 name text not null check (length(trim(name)) between 2 and 120),
 dob date check (dob <= current_date),
 phone text check (length(phone) <= 25),
 created_at timestamptz not null default now()
);
create table public.visits (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.patients,
 urgent boolean not null default false,
 opened_at timestamptz not null default now(),
 opened_by uuid not null default auth.uid()
);
create index on public.visits(patient_id,opened_at desc);
create table public.events (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null references public.visits,
 kind text not null check (kind in ('registration_payment','vitals','consultation','lab_order','lab_result','prescription','pharmacy_payment','dispense','surgery_referral','surgery_note','maternity','discharge')),
 parent_id uuid references public.events,
 details jsonb not null check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 10000),
 actor uuid not null default auth.uid(),
 recorded_at timestamptz not null default clock_timestamp()
);
create index on public.events(visit_id,recorded_at);
create unique index on public.events(visit_id,kind) where kind in ('registration_payment','vitals','discharge');
create unique index on public.events(parent_id,kind) where parent_id is not null;
create unique index on public.events((details->>'reference')) where kind in ('registration_payment','pharmacy_payment');

alter table public.staff enable row level security;
alter table public.patients enable row level security;
alter table public.visits enable row level security;
alter table public.events enable row level security;
revoke all on public.staff,public.patients,public.visits,public.events from public,anon,authenticated;
grant select on public.staff,public.patients,public.visits,public.events to authenticated;
grant insert (name,dob,phone) on public.patients to authenticated;
grant insert (patient_id,urgent) on public.visits to authenticated;
grant insert (visit_id,kind,parent_id,details) on public.events to authenticated;

create policy staff_read on public.staff for select to authenticated
using ((id = (select auth.uid()) and active) or (select octo_private.staff_role()) = 'admin');
create policy patient_read on public.patients for select to authenticated
using ((select octo_private.staff_role()) is not null);
create policy patient_create on public.patients for insert to authenticated
with check ((select octo_private.staff_role()) in ('cashier','admin'));
create policy visit_read on public.visits for select to authenticated
using ((select octo_private.staff_role()) is not null);
create policy visit_create on public.visits for insert to authenticated
with check ((select octo_private.staff_role()) in ('cashier','admin'));

create policy events_read on public.events for select to authenticated using (
 case (select octo_private.staff_role())
 when 'doctor' then true when 'nurse' then true when 'surgeon' then true
 when 'admin' then kind in ('registration_payment','pharmacy_payment','dispense','discharge')
 when 'cashier' then kind in ('registration_payment','pharmacy_payment','dispense','discharge')
 when 'lab' then kind in ('lab_order','lab_result','discharge')
 when 'pharmacy' then kind in ('prescription','pharmacy_payment','dispense','discharge')
 else false end
);

create function octo_private.can_record(role_name text, event_kind text) returns boolean
language sql immutable set search_path = '' as $$
 select case event_kind
 when 'registration_payment' then role_name in ('admin','cashier')
 when 'vitals' then role_name = 'nurse'
 when 'consultation' then role_name = 'doctor'
 when 'lab_order' then role_name in ('doctor','surgeon')
 when 'lab_result' then role_name = 'lab'
 when 'prescription' then role_name in ('doctor','surgeon')
 when 'pharmacy_payment' then role_name in ('cashier','admin')
 when 'dispense' then role_name = 'pharmacy'
 when 'surgery_referral' then role_name = 'doctor'
 when 'surgery_note' then role_name = 'surgeon'
 when 'maternity' then role_name in ('doctor','nurse')
 when 'discharge' then role_name in ('doctor','surgeon')
 else false end
$$;
revoke all on function octo_private.can_record(text,text) from public,anon;
grant execute on function octo_private.can_record(text,text) to authenticated;

create policy events_create on public.events for insert to authenticated
with check (actor = (select auth.uid()) and octo_private.can_record((select octo_private.staff_role()),kind));

create function octo_private.validate_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
 is_urgent boolean;
 parent_kind text;
 field text;
 required_fields text[];
begin
 if auth.uid() is null or not coalesce(octo_private.can_record(octo_private.staff_role(),new.kind),false) then
   raise exception 'This account cannot record this action';
 end if;
 select urgent into is_urgent from public.visits where id = new.visit_id for update;
 if not found then raise exception 'Visit not found'; end if;
 if exists(select 1 from public.events where visit_id = new.visit_id and kind='discharge') then
   raise exception 'This visit is closed';
 end if;
 if new.kind = 'vitals' and not is_urgent and not exists(
   select 1 from public.events where visit_id=new.visit_id and kind='registration_payment'
 ) then raise exception 'Confirm the card payment first'; end if;
 if new.kind = 'consultation' and not is_urgent and not exists(
   select 1 from public.events where visit_id=new.visit_id and kind='vitals'
 ) then raise exception 'Record vitals first'; end if;
 if new.kind in ('lab_order','prescription','surgery_referral','discharge') and not exists(
   select 1 from public.events where visit_id=new.visit_id and kind='consultation'
 ) then raise exception 'Save a consultation first'; end if;

 parent_kind := case new.kind when 'lab_result' then 'lab_order'
 when 'pharmacy_payment' then 'prescription' when 'dispense' then 'prescription'
 when 'surgery_note' then 'surgery_referral' end;
 if parent_kind is null and new.parent_id is not null then raise exception 'Unexpected linked order'; end if;
 if parent_kind is not null and not exists(
   select 1 from public.events where id=new.parent_id and visit_id=new.visit_id and kind=parent_kind
 ) then raise exception 'Select a valid order for this visit'; end if;
 if new.kind='dispense' and not exists(
   select 1 from public.events where parent_id=new.parent_id and kind='pharmacy_payment'
 ) then raise exception 'Confirm pharmacy payment first'; end if;
 if new.kind='discharge' and exists(
  select 1 from public.events e where e.visit_id=new.visit_id and e.kind in ('lab_order','prescription','surgery_referral')
  and not exists(select 1 from public.events child where child.parent_id=e.id and child.kind in ('lab_result','dispense','surgery_note'))
 ) then raise exception 'Complete the outstanding orders before closing the visit'; end if;

 required_fields := case new.kind
 when 'registration_payment' then array['amount','method','reference']
 when 'pharmacy_payment' then array['amount','method','reference']
 when 'vitals' then array['weight','height','temperature','pulse','bp']
 when 'consultation' then array['complaint','assessment','plan']
 when 'lab_order' then array['test']
 when 'lab_result' then array['result']
 when 'prescription' then array['medicine','instructions']
 when 'dispense' then array['notes']
 when 'surgery_referral' then array['procedure','notes']
 when 'surgery_note' then array['outcome']
 when 'maternity' then array['notes']
 when 'discharge' then array['notes'] end;
 foreach field in array required_fields loop
   if jsonb_typeof(new.details->field) is distinct from 'string' or coalesce(length(trim(new.details->>field)),0)=0 then
     raise exception 'Required field missing: %', field;
   end if;
 end loop;
 if new.kind in ('registration_payment','pharmacy_payment') then
   if (new.details->>'amount') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
     or (new.details->>'amount')::numeric <= 0 then raise exception 'Enter a valid payment amount'; end if;
   if new.details->>'method' not in ('Cash','Transfer','POS') then raise exception 'Select a payment method'; end if;
   new.details := jsonb_set(new.details,'{reference}',to_jsonb(upper(trim(new.details->>'reference'))));
 end if;
 if new.kind = 'vitals' then
   if (new.details->>'weight')::numeric not between 0.2 and 500
   or (new.details->>'height')::numeric not between 15 and 270
   or (new.details->>'temperature')::numeric not between 20 and 48
   or (new.details->>'pulse')::numeric not between 1 and 350
   or (new.details->>'bp') !~ '^[0-9]{2,3}/[0-9]{1,3}$' then
     raise exception 'Check the vitals and measurement units';
   end if;
   new.details := jsonb_set(new.details,'{bmi}',to_jsonb(round(
    (new.details->>'weight')::numeric / power((new.details->>'height')::numeric / 100,2),1)));
 end if;
 return new;
end $$;
revoke all on function octo_private.validate_event() from public,anon,authenticated;
create trigger validate_event before insert on public.events for each row execute function octo_private.validate_event();

-- Cashiers need the prescription identifier to reconcile payment without receiving medication details.
create function octo_private.open_prescription_refs(visit uuid)
returns table(id uuid, recorded_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select e.id,e.recorded_at from public.events e
 where e.visit_id=visit and e.kind='prescription' and octo_private.staff_role() in ('admin','cashier')
 and not exists(select 1 from public.events p where p.parent_id=e.id and p.kind='pharmacy_payment')
 order by e.recorded_at
$$;
revoke all on function octo_private.open_prescription_refs(uuid) from public,anon;
grant execute on function octo_private.open_prescription_refs(uuid) to authenticated;
create function public.open_prescription_refs(visit uuid)
returns table(id uuid, recorded_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from octo_private.open_prescription_refs(visit) $$;
revoke all on function public.open_prescription_refs(uuid) from public,anon;
grant execute on function public.open_prescription_refs(uuid) to authenticated;
