CREATE TABLE IF NOT EXISTS payment_method_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES receivers(id) ON DELETE SET NULL,
    method_type VARCHAR(50) NOT NULL CHECK (method_type IN ('paypal', 'cashapp')),
    assigned_value TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_at TIMESTAMP WITH TIME ZONE,
    response_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_payment_method_request_status
        CHECK (status IN ('pending', 'assigned', 'sent', 'cancelled'))
);

CREATE TRIGGER update_payment_method_requests_modtime
BEFORE UPDATE ON payment_method_requests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE payment_method_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage payment method requests"
ON payment_method_requests
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Receivers can insert payment method requests"
ON payment_method_requests
FOR INSERT
TO anon
WITH CHECK (true);

ALTER PUBLICATION supabase_realtime
ADD TABLE payment_method_requests;
