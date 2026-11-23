# OCTO Hospital

OCTO is a fictional hospital website and a staff workflow pilot. Run the practice workspace with fictional records to try the front desk, nursing, consultation, lab, pharmacy, surgery, maternity and staff administration screens.

## Run locally

```sh
python3 -m http.server 8080 --directory public
```

Open `http://localhost:8080`, select **Staff sign in**, then **Open practice workspace**. Practice mode stores records in memory only and lets you switch roles without affecting Supabase. Staff sign-in uses the hospital's Supabase instance and requires an administrator-provisioned account.

## One hospital per installation

Each real hospital should own an independent Supabase project, its authentication and private staff storage, plus a Vercel project with its own domain. The demo already has its own Supabase project. The two sample locations on the public site are illustrative. To create another installation, apply the SQL migrations in order, deploy the `staff` Edge Function, and replace the URL and publishable key in `public/config.js`. Never put a service-role key, live records, a database dump or staff credentials in source control. For portability, keep the migrations, function and this README in the hospital's GitHub repository and document its database and private storage restore procedures.

Import the repository into Vercel as **Other**. Vercel serves `public` as defined in `vercel.json`. Configure the Supabase Auth Site URL and redirect allow-list to include the canonical Vercel or hospital URL and its `/staff.html` path. Configure a hospital-managed transactional SMTP service for staff invitations, and set the Edge Function's `OCTO_SITE_URL` secret to the canonical origin. The function verifies the user's JWT with Supabase Auth and checks the active administrator role server-side. Disable public signups, including anonymous sign-ins, and keep email/password sign-in enabled. Use the default implicit invite redirect or adapt the invitation callback for your Auth flow.

### First administrator

An owner of the Supabase project must invite or create the first administrator through **Authentication → Users**. Give each person an individual account. In the SQL Editor, copy the Auth user's email exactly into the following query. Review the returned ID before proceeding.

```sql
insert into public.staff(id,name,email,role)
select id,'Hospital Administrator',email,'admin'
from auth.users
where lower(email)=lower('REPLACE_WITH_ADMIN_EMAIL')
returning id,email,role;
```

The existing administrator can invite other staff from **Staff accounts**, assign a role and suspend or restore access. An invitation lets staff set their own password. The public website has no signup form or patient sign-in. Cashiers with provisioning duties use the administrator role. Dedicated cashier accounts handle registration and payment.

### Day-to-day workflow

1. Search by card or patient name before creating a record. Register the patient and open a visit. Record the card payment with its unique receipt reference. The card payment is recorded once. Returning patients use the same card number when staff open a new visit. An urgent encounter can proceed to care before payment.
2. The nurse records blood pressure, weight, height, temperature and pulse. OCTO calculates BMI and puts the routine visit in the clinician queue.
3. The doctor reads the patient's previous entries and saves a complaint, assessment and care plan. They can request laboratory tests, prescribe, refer to surgery or add a maternity note.
4. The laboratory records results against the specific order. Pharmacy adds an NGN quote, the cashier confirms the same amount, and pharmacy confirms dispensing. The surgeon records procedure outcome and aftercare against the referral.
5. The clinician records follow-up instructions and closes the visit after outstanding orders are completed. A new visit preserves the prior record and its author IDs.

Run `supabase/tests/workflow.sql` as the project owner against an isolated test database. The script rolls back its synthetic fixture rows.

## Pilot boundaries

Payments record cash, POS or transfer that staff have verified manually. The pilot does not collect funds, run automated clinical decisions, capture fingerprints, send reports by email, or expose patient data through the public site. A maternity note is supported, while a complete antenatal schedule and inpatient/bed management are separate modules. The workspace needs connectivity.

Before use with real records, obtain the hospital's clinical and privacy review, confirm deployment region and data-transfer arrangements, and complete the applicable Nigeria Data Protection Act assessment. Verify backup and restore for Postgres and private files, enforce staff MFA, define clinical corrections and downtime procedures, and add production-grade access auditing. The current role model limits lab and pharmacy records to patients with relevant orders. Clinical users can view the history their role permits within their hospital. Current auditing records the author and time of saved clinical events.

## References

- [Bahmni patient dashboard](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/5442240665/Patient%2BDashboard%2B2.0)
- [Bahmni laboratory workflow](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32014460/Using%2BLab%2BDashboard)
- [Nigeria Data Protection Act 2023](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf)
- [NDPC General Application and Implementation Directive 2025](https://ndpc.gov.ng/wp-content/uploads/2025/03/NDP-ACT-GAID-2025-MARCH-20TH.pdf)
