begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','octo-test-cashier@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','octo-test-nurse@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','octo-test-doctor@example.invalid'),
 ('10000000-0000-0000-0000-000000000004','octo-test-lab@example.invalid'),
 ('10000000-0000-0000-0000-000000000005','octo-test-pharmacy@example.invalid'),
 ('10000000-0000-0000-0000-000000000006','octo-test-surgeon@example.invalid'),
 ('10000000-0000-0000-0000-000000000007','octo-test-offboarded@example.invalid'),
 ('10000000-0000-0000-0000-000000000008','octo-test-admin@example.invalid');
insert into public.staff(id,name,email,role,active) values
 ('10000000-0000-0000-0000-000000000001','Test cashier','octo-test-cashier@example.invalid','cashier',true),
 ('10000000-0000-0000-0000-000000000002','Test nurse','octo-test-nurse@example.invalid','nurse',true),
 ('10000000-0000-0000-0000-000000000003','Test doctor','octo-test-doctor@example.invalid','doctor',true),
 ('10000000-0000-0000-0000-000000000004','Test lab','octo-test-lab@example.invalid','lab',true),
 ('10000000-0000-0000-0000-000000000005','Test pharmacy','octo-test-pharmacy@example.invalid','pharmacy',true),
 ('10000000-0000-0000-0000-000000000006','Test surgeon','octo-test-surgeon@example.invalid','surgeon',true),
 ('10000000-0000-0000-0000-000000000007','Test offboarded','octo-test-offboarded@example.invalid','doctor',false),
 ('10000000-0000-0000-0000-000000000008','Test admin','octo-test-admin@example.invalid','admin',true);
set local role authenticated;
do $$
declare p uuid; v uuid; lab uuid; drug uuid; surgery uuid; other_patient uuid; urgent_visit uuid; returning_visit uuid; bed uuid; admission uuid; item uuid; booking uuid;
begin
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 insert into public.patients(name) values ('Fictional workflow patient') returning id into p;
 insert into public.patients(name) values ('Fictional unrelated patient') returning id into other_patient;
 insert into public.visits(patient_id) values (p) returning id into v;
 insert into public.visits(patient_id,urgent) values (other_patient,true) returning id into urgent_visit;

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
 begin
  insert into public.events(visit_id,kind,details) values(v,'vitals','{"weight":"68","height":"170","temperature":"36.4","pulse":"76","bp":"118/76"}');
  raise exception 'Vitals were allowed without payment';
 exception when raise_exception then
  if sqlerrm <> 'Confirm the card payment first' then raise; end if;
 end;
 insert into public.events(visit_id,kind,details) values(urgent_visit,'vitals','{"weight":"60","height":"165","temperature":"36.5","pulse":"79","bp":"115/74"}');

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 insert into public.events(visit_id,kind,details) values(v,'registration_payment','{"amount":"3500","method":"Cash","reference":"OCTO-TEST-001"}');
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
 insert into public.events(visit_id,kind,details) values(v,'vitals','{"weight":"68","height":"170","temperature":"36.4","pulse":"76","bp":"118/76"}');
 if not exists(select 1 from public.events where visit_id=v and kind='vitals' and details->>'bmi'='23.5') then raise exception 'BMI missing'; end if;

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
 insert into public.events(visit_id,kind,details) values(v,'consultation','{"complaint":"Demo","assessment":"Demo","plan":"Demo"}');
 insert into public.events(visit_id,kind,details) values(v,'maternity','{"notes":"Demo follow-up"}');
 insert into public.events(visit_id,kind,details) values(v,'lab_order','{"test":"Demo test"}') returning id into lab;
 insert into public.events(visit_id,kind,details) values(v,'prescription','{"medicine":"Demo medication","instructions":"Synthetic"}') returning id into drug;
 insert into public.events(visit_id,kind,details) values(v,'surgery_referral','{"procedure":"Demo procedure","notes":"Demo referral"}') returning id into surgery;
 begin
  insert into public.events(visit_id,kind,details) values(v,'discharge','{"notes":"Demo"}');
  raise exception 'Unfinished visit closed';
 exception when raise_exception then
  if sqlerrm <> 'Complete the outstanding orders before closing the visit' then raise; end if;
 end;

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
 if exists(select 1 from public.patients where id=other_patient) then raise exception 'Lab can view unrelated patient'; end if;
 if exists(select 1 from public.events where visit_id=v and kind='consultation') then raise exception 'Lab can read consultation'; end if;
 insert into public.events(visit_id,kind,parent_id,details) values(v,'lab_result',lab,'{"result":"Demo result"}');

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
 insert into public.events(visit_id,kind,parent_id,details) values(v,'pharmacy_quote',drug,'{"amount":"1500"}');
 begin
  insert into public.events(visit_id,kind,parent_id,details) values(v,'dispense',drug,'{"notes":"Demo"}');
  raise exception 'Unpaid dispensing allowed';
 exception when raise_exception then
  if sqlerrm <> 'Confirm pharmacy payment first' then raise; end if;
 end;

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 if exists(select 1 from public.events where visit_id=v and kind='prescription') then raise exception 'Cashier can read prescription'; end if;
 if not exists(select 1 from public.open_prescription_refs(v) where id=drug) then raise exception 'Cashier cannot reconcile quote'; end if;
 begin
  insert into public.events(visit_id,kind,parent_id,details) values(v,'pharmacy_payment',drug,'{"amount":"1499","method":"POS","reference":"OCTO-TEST-002"}');
  raise exception 'Incorrect payment amount accepted';
 exception when raise_exception then
  if sqlerrm <> 'The payment must match the pharmacy quote' then raise; end if;
 end;
 insert into public.events(visit_id,kind,parent_id,details) values(v,'pharmacy_payment',drug,'{"amount":"1500","method":"POS","reference":"OCTO-TEST-002"}');

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
 insert into public.events(visit_id,kind,parent_id,details) values(v,'dispense',drug,'{"notes":"Demo dispensing"}');

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
 insert into public.events(visit_id,kind,parent_id,details) values(v,'surgery_note',surgery,'{"outcome":"Demo outcome"}');

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
 insert into public.events(visit_id,kind,details) values(v,'discharge','{"notes":"Demo follow-up"}');
 if not exists(select 1 from public.visit_stages(p) s where s.id=v and s.stage->>'closed'='true') then raise exception 'Closed visit missing from history'; end if;

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 insert into public.visits(patient_id) values(p) returning id into returning_visit;
 if not exists(select 1 from public.visit_stages(p) s where s.id=returning_visit and s.stage->>'paid'='true') then raise exception 'Returning patient card state missing'; end if;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
 insert into public.events(visit_id,kind,details) values(returning_visit,'vitals','{"weight":"68","height":"170","temperature":"36.4","pulse":"76","bp":"118/76"}');

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000008',true);
 insert into public.beds(ward,label) values('Pilot ward','Test bed') returning id into bed;
 if not exists(select 1 from public.daily_operations((now() at time zone 'Africa/Lagos')::date) r where r.card_payments=3500 and r.pharmacy_payments=1500) then raise exception 'Receipt report incorrect'; end if;
 insert into public.appointments(patient_id,starts_at,clinic) values(p,now()+interval '1 day','Maternity') returning id into booking;
 update public.appointments set status='Arrived' where id=booking;
 if not exists(select 1 from public.appointments where id=booking and status='Arrived') then raise exception 'Booking status missing'; end if;

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
 insert into public.admissions(patient_id,bed_id) values(p,bed) returning id into admission;
 begin
  insert into public.admissions(patient_id,bed_id) values(other_patient,bed);
  raise exception 'Double bed allocation accepted';
 exception when unique_violation then null;
 end;
 update public.admissions set released_at=now() where id=admission;
 insert into public.admissions(patient_id,bed_id) values(other_patient,bed);

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
 insert into public.stock_items(name,reorder_level) values('Synthetic stock item',3) returning id into item;
 insert into public.stock_movements(item_id,quantity,reference) values(item,10,'TEST-IN'),(item,-7,'TEST-OUT');
 if not exists(select 1 from public.stock_balance b where b.id=item and b.quantity=3) then raise exception 'Stock balance incorrect'; end if;
 begin
  insert into public.stock_movements(item_id,quantity,reference) values(item,-4,'TEST-OVER');
  raise exception 'Negative stock accepted';
 exception when raise_exception then
  if sqlerrm <> 'Insufficient stock' then raise; end if;
 end;
 if exists(select 1 from public.appointments) or exists(select 1 from public.daily_operations(current_date)) then raise exception 'Pharmacy can see other department data'; end if;

 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
 if exists(select 1 from public.patients) or exists(select 1 from public.recent_queue()) then raise exception 'Suspended staff retained access'; end if;
end;
$$;
reset role;
rollback;
select 'OCTO workflow and access tests passed' as result;
