alter policy department_read on public.beds
using ((select octo_private.staff_role()) in ('admin','nurse','doctor'));
alter policy department_read on public.admissions
using ((select octo_private.staff_role()) in ('admin','nurse','doctor'));
