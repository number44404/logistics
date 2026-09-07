-- 1. Create Staff Users Table
CREATE TABLE IF NOT EXISTS staff_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Customer Care Agent', 'Operations Staff')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for Staff Users
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view staff_users" ON staff_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage staff_users" ON staff_users FOR ALL TO authenticated USING (true);

-- 2. Update Support Tickets Table
-- Add customer_id linking to receivers
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES receivers(id) ON DELETE SET NULL;

-- 3. Update Notifications Log Table
ALTER TABLE notifications_log ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES staff_users(id) ON DELETE CASCADE;
ALTER TABLE notifications_log ADD COLUMN IF NOT EXISTS read_status BOOLEAN DEFAULT false;

-- Add a message column if it doesn't exist (aliasing body)
ALTER TABLE notifications_log ADD COLUMN IF NOT EXISTS message TEXT;

-- Enable Realtime for staff_users just in case
ALTER PUBLICATION supabase_realtime ADD TABLE staff_users;

