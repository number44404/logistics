-- ==========================================
-- 1. CLEANUP OLD TABLES (Prevents Conflicts)
-- ==========================================
DROP TABLE IF EXISTS tracking_events CASCADE;
DROP TABLE IF EXISTS shipments CASCADE;
DROP TABLE IF EXISTS admins CASCADE;


-- ==========================================
-- 2. CREATE DATABASE STRUCTURE
-- ==========================================

-- ADMINS TABLE
CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR,
    email VARCHAR UNIQUE NOT NULL,
    role VARCHAR DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_admins_user_id ON admins(user_id);

-- SHIPMENTS TABLE
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_number VARCHAR UNIQUE NOT NULL,
    customer_name VARCHAR,
    customer_email VARCHAR,
    customer_phone VARCHAR,
    package_description TEXT,
    package_weight VARCHAR,
    origin_country VARCHAR,
    origin_city VARCHAR,
    destination_country VARCHAR,
    destination_city VARCHAR,
    status VARCHAR,
    estimated_delivery VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_shipments_tracking_number ON shipments(tracking_number);

-- TRACKING_EVENTS TABLE
CREATE TABLE tracking_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE NOT NULL,
    status VARCHAR,
    location VARCHAR,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_tracking_events_shipment_id ON tracking_events(shipment_id);


-- ==========================================
-- 3. APPLY SECURITY POLICIES (RLS)
-- ==========================================

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;

-- Admins Security
CREATE POLICY "Admins can view own profile" ON admins FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "System manages admins" ON admins FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Shipments Security
CREATE POLICY "Customers can search shipments" ON shipments FOR SELECT TO anon USING (true);
CREATE POLICY "Admins have full access to shipments" ON shipments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Tracking Events Security
CREATE POLICY "Customers can view tracking events" ON tracking_events FOR SELECT TO anon USING (true);
CREATE POLICY "Admins have full access to tracking events" ON tracking_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
