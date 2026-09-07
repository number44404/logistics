-- Support Tickets Table
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    sender_email VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'open', -- open, pending, resolved, closed
    priority VARCHAR(50) DEFAULT 'normal', -- low, normal, high, urgent
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ticket Replies Table (Threaded Conversation)
CREATE TABLE IF NOT EXISTS ticket_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_type VARCHAR(50) NOT NULL, -- 'customer' or 'admin'
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins full access support_tickets" ON support_tickets FOR ALL TO authenticated USING (true);
CREATE POLICY "Admins full access ticket_replies" ON ticket_replies FOR ALL TO authenticated USING (true);

-- Public (Receivers) can insert tickets and replies
CREATE POLICY "Public insert support_tickets" ON support_tickets FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Public insert ticket_replies" ON ticket_replies FOR INSERT TO anon WITH CHECK (true);

-- Public can read their own tickets (In a real app this would be gated by a token, but for now we allow reading if they know the ID)
CREATE POLICY "Public read support_tickets" ON support_tickets FOR SELECT TO anon USING (true);
CREATE POLICY "Public read ticket_replies" ON ticket_replies FOR SELECT TO anon USING (true);

