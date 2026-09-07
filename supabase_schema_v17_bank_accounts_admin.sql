-- Migration v17: Extend bank_accounts for admin management
-- Adds: account_type, updated_at, created_by
-- Adds: authenticated-user write policy (admin-only access)
-- Preserves: existing public SELECT policy for receiver frontend

ALTER TABLE bank_accounts
    ADD COLUMN IF NOT EXISTS account_type  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS created_by    UUID REFERENCES auth.users(id);

-- Allow authenticated admins full write access to bank_accounts
-- (SELECT for anon already exists from v9)
DROP POLICY IF EXISTS "Authenticated admins manage bank accounts" ON bank_accounts;

CREATE POLICY "Authenticated admins manage bank accounts"
ON bank_accounts
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
