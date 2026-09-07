-- Create payment_methods table
CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL UNIQUE,
    instructions TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default methods
INSERT INTO payment_methods (name, type, instructions) VALUES
('Bank Transfer', 'bank', 'Transfer funds directly to our bank account.'),
('Credit Card', 'card', 'Pay securely with your credit or debit card.'),
('Gift Card', 'gift_card', 'Redeem a valid logistics gift card.')
ON CONFLICT (type) DO NOTHING;

-- Create bank_accounts table
CREATE TABLE IF NOT EXISTS bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bank_name VARCHAR(100) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(100) NOT NULL,
    routing_number VARCHAR(100),
    currency VARCHAR(10) DEFAULT 'USD',
    instructions TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default bank account
INSERT INTO bank_accounts (bank_name, account_name, account_number, routing_number, currency, instructions) VALUES
('First National Bank', 'UPS Logistics Company', '1234567890', '098765432', 'USD', 'Please include your Tracking Number in the transfer reference.')
ON CONFLICT DO NOTHING;

-- Enable RLS and allow public read access
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read payment_methods" ON payment_methods FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "Public read bank_accounts" ON bank_accounts FOR SELECT TO anon USING (is_active = true);
