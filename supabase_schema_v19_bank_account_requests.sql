CREATE TABLE IF NOT EXISTS bank_account_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES receivers(id) ON DELETE SET NULL,
    assigned_bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_at TIMESTAMP WITH TIME ZONE,
    response_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_bank_account_request_status CHECK (status IN ('pending', 'assigned', 'sent', 'cancelled'))
);
CREATE TRIGGER update_bank_account_requests_modtime BEFORE UPDATE ON bank_account_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE bank_account_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can manage bank account requests" ON bank_account_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Receivers can insert bank account requests" ON bank_account_requests FOR INSERT TO anon WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE bank_account_requests;
