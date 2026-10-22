-- Ganah Dental — give a Supabase account access to the clinic (run after schema.sql).
-- 1) Create the account: Supabase → Authentication → Users → Add user → Create new user
--    (email + password, tick "Auto Confirm User").
-- 2) Put that same email below, then Run.

insert into public.clinic_members (clinic_id, user_id)
select c.id, u.id from public.clinics c, auth.users u
where u.email = 'CLINIC-EMAIL@example.com'   -- ← إيميل حساب العيادة
on conflict do nothing;

-- Check: one row with the clinic name and the email.
select c.name, u.email from public.clinic_members m
join public.clinics c on c.id = m.clinic_id
join auth.users u on u.id = m.user_id;
