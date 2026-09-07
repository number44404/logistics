-- Admin Devices for Push Notifications (Future implementation)
CREATE TABLE IF NOT EXISTS admin_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL, -- Assuming linked to auth.uid() in a full auth setup
    device_token VARCHAR(255) NOT NULL UNIQUE,
    platform VARCHAR(50),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications Log (App Notification Center)
CREATE TABLE IF NOT EXISTS notifications_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    related_id UUID, -- E.g., shipment_id
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE admin_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_log ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admin full access devices" ON admin_devices FOR ALL TO authenticated USING (true);
CREATE POLICY "Admin full access notifications" ON notifications_log FOR ALL TO authenticated USING (true);

-- Enable Realtime for notifications so the dashboard can ring/alert
ALTER PUBLICATION supabase_realtime ADD TABLE notifications_log;

