-- 021: the 28 customers whose phone number matched nothing
--
-- normalizePhone reduces an Egyptian mobile to 01XXXXXXXXX so that everything
-- else — the importer's duplicate check, and now the customer portal's proof of
-- ownership — has one form to compare against. It handled "+20 1000500577"
-- (country code, local part without its leading zero) but not
-- "+20 01000500577" (country code in front of the WHOLE local number), which is
-- how 28 records were typed.
--
-- Those 28 stored 2001000500577. Nothing matches that. They were invisible to
-- the duplicate check on import, and under the customer portal their owners
-- would have been unable to prove their own car was theirs.
--
-- src/lib/phone.js is fixed; this brings the stored column in line. The portal
-- re-normalises the raw `phone` at read time anyway, so it does not depend on
-- this having been run — but every other reader of phone_norm does.
--
-- Only the doubled-country-code shape is touched. An Egyptian landline
-- (0244828359) and twelve foreign numbers (+218…, +1…) are correctly not
-- 01XXXXXXXXX and are left exactly as they are.
--
-- Apply by hand against Supabase, like every other file here. Idempotent: the
-- WHERE clause stops matching once the row is fixed.

-- "+20" or "0020" in front of the full local number: 2001XXXXXXXXX -> 01XXXXXXXXX
UPDATE public.customers
   SET phone_norm = substring(phone_norm from 3)
 WHERE phone_norm ~ '^2001[0-9]{9}$';

-- "+20" in front of the local part: 201XXXXXXXXX -> 01XXXXXXXXX. Already
-- handled by the old normaliser, so this should touch nothing; here so the SQL
-- and src/lib/phone.js describe the same rule rather than nearly the same one.
UPDATE public.customers
   SET phone_norm = '0' || substring(phone_norm from 3)
 WHERE phone_norm ~ '^201[0-9]{9}$';
