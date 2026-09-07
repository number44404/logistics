-- Migration v18: Customer Care Requests table
-- Used when a receiver selects Gift Card payment — escalates to staff instead of self-serving.

CREATE TABLE IF NOT EXISTS customer_care_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id  UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    receiver_id  UUID REFERENCES receivers(id) ON DELETE SET NULL,
    request_type VARCHAR(100) NOT NULL DEFAULT 'gift_card_payment',
    status       VARCHAR(50)  NOT NULL DEFAULT 'open',
    assigned_to  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE customer_care_requests ENABLE ROW LEVEL SECURITY;

-- Public (anon) can INSERT — receiver is unauthenticated
CREATE POLICY "Receivers can create care requests"
ON customer_care_requests
FOR INSERT
TO anon
WITH CHECK (true);

-- Authenticated staff can read and update all requests
CREATE POLICY "Staff can manage care requests"
ON customer_care_requests
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Enable Realtime so receiver page can listen for acknowledgement
ALTER PUBLICATION supabase_realtime ADD TABLE customer_care_requests;
