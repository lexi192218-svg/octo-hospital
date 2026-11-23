alter table public.events drop constraint events_kind_check;
alter table public.events add constraint events_kind_check check (kind in (
'registration_payment','vitals','consultation','medication_given','lab_order','lab_result','prescription','pharmacy_quote','pharmacy_payment','dispense','surgery_referral','surgery_note','maternity','discharge'));
create or replace function octo_private.can_record(role_name text, event_kind text) returns boolean
language sql immutable set search_path = '' as $$
 select case event_kind
 when 'registration_payment' then role_name in ('admin','cashier')
 when 'vitals' then role_name = 'nurse'
 when 'consultation' then role_name = 'doctor'
 when 'medication_given' then role_name = 'doctor'
 when 'lab_order' then role_name in ('doctor','surgeon')
 when 'lab_result' then role_name = 'lab'
 when 'prescription' then role_name in ('doctor','surgeon')
 when 'pharmacy_quote' then role_name = 'pharmacy'
 when 'pharmacy_payment' then role_name in ('cashier','admin')
 when 'dispense' then role_name = 'pharmacy'
 when 'surgery_referral' then role_name = 'doctor'
 when 'surgery_note' then role_name = 'surgeon'
 when 'maternity' then role_name in ('doctor','nurse')
 when 'discharge' then role_name in ('doctor','surgeon')
 else false end
$$;
create or replace function octo_private.validate_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
 is_urgent boolean;
 person_id uuid;
 card_paid boolean;
 parent_kind text;
 field text;
 required_fields text[];
begin
 if auth.uid() is null or not coalesce(octo_private.can_record(octo_private.staff_role(),new.kind),false) then
   raise exception 'This account cannot record this action';
 end if;
 select urgent,patient_id into is_urgent,person_id from public.visits where id = new.visit_id for update;
 if not found then raise exception 'Visit not found'; end if;
 if exists(select 1 from public.events where visit_id = new.visit_id and kind='discharge') then
   raise exception 'This visit is closed';
 end if;
 if new.kind in ('registration_payment','vitals') then
   perform 1 from public.patients where id=person_id for update;
   select exists (
     select 1 from public.visits v join public.events e on e.visit_id=v.id
     where v.patient_id=person_id and e.kind='registration_payment'
   ) into card_paid;
   if new.kind='registration_payment' and card_paid then raise exception 'This patient already has a paid card'; end if;
   if new.kind='vitals' and not is_urgent and not card_paid then raise exception 'Confirm the card payment first'; end if;
 end if;
 if new.kind = 'consultation' and not is_urgent and not exists(
   select 1 from public.events where visit_id=new.visit_id and kind='vitals'
 ) then raise exception 'Record vitals first'; end if;
 if new.kind in ('lab_order','prescription','surgery_referral','discharge','medication_given') and not exists(
   select 1 from public.events where visit_id=new.visit_id and kind='consultation'
 ) then raise exception 'Save a consultation first'; end if;

 parent_kind := case new.kind when 'lab_result' then 'lab_order'
 when 'pharmacy_quote' then 'prescription' when 'pharmacy_payment' then 'prescription' when 'dispense' then 'prescription'
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
 when 'pharmacy_quote' then array['amount']
 when 'pharmacy_payment' then array['amount','method','reference']
 when 'vitals' then array['weight','height','temperature','pulse','bp']
 when 'consultation' then array['complaint','assessment','plan']
 when 'medication_given' then array['medicine','dose','route']
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
 if new.kind in ('registration_payment','pharmacy_quote','pharmacy_payment') then
   if (new.details->>'amount') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
     or (new.details->>'amount')::numeric <= 0 then raise exception 'Enter a valid payment amount'; end if;
 end if;
 if new.kind = 'pharmacy_payment' and not exists (
   select 1 from public.events where parent_id=new.parent_id and kind='pharmacy_quote'
   and (details->>'amount')::numeric = (new.details->>'amount')::numeric
 ) then raise exception 'The payment must match the pharmacy quote'; end if;
 if new.kind in ('registration_payment','pharmacy_payment') then
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
