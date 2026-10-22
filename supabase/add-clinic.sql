-- Ganah Dental — link the clinic account (run once, after schema.sql).
-- 1) Create the account first: Supabase → Authentication → Users → Add user → Create new user
--    (email + password, tick "Auto Confirm User").
-- 2) Put that same email in the line below, then Run.

with c as (
  insert into public.clinics (name) values ('عيادة جنة لطب الفم والأسنان') returning id
)
insert into public.clinic_members (clinic_id, user_id)
select c.id, u.id from c, auth.users u
where u.email = 'CLINIC-EMAIL@example.com';   -- ← اكتب إيميل حساب العيادة هنا

-- Check: this should show one row with your clinic name and email.
select c.name, u.email from public.clinic_members m
join public.clinics c on c.id = m.clinic_id
join auth.users u on u.id = m.user_id;
