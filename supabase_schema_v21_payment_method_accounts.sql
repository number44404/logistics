-- Create structured accounts for PayPal / Cash App and link to requests
CREATE TABLE IF NOT EXISTS payment_method_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    method_type VARCHAR(50) NOT NULL, -- 'paypal' | 'cashapp'
    label VARCHAR(100),
    account_value TEXT NOT NULL, -- email / cashtag / url
    instructions TEXT,
    is_active BOOLEAN DEFAULT false,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add FK to payment_method_requests for structured assignment
ALTER TABLE IF EXISTS payment_method_requests
    ADD COLUMN IF NOT EXISTS assigned_payment_method_account_id UUID REFERENCES payment_method_accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_by UUID,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE;

-- Trigger to update updated_at exists globally; enable RLS and a staff policy
ALTER TABLE payment_method_accounts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'Staff can manage payment_method_accounts'
          AND tablename = 'payment_method_accounts'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY "Staff can manage payment_method_accounts"
            ON payment_method_accounts
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
        $policy$;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Keep existing behaviour: receivers can still insert requests
ALTER TABLE IF EXISTS payment_method_requests ENABLE ROW LEVEL SECURITY;

-- Add publication for realtime if needed
ALTER PUBLICATION supabase_realtime
    ADD TABLE payment_method_accounts;
