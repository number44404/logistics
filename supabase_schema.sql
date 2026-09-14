-- 0. Drop existing tables if they exist (WARNING: This deletes existing data)
DROP TABLE IF EXISTS tracking_events;
DROP TABLE IF EXISTS shipments;

-- 1. Create the shipments table
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_number VARCHAR UNIQUE NOT NULL,
    customer_name VARCHAR,
    package_service VARCHAR,
    package_weight VARCHAR,
    origin VARCHAR,
    destination VARCHAR,
    status VARCHAR,
    estimated_delivery VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create the tracking_events table
CREATE TABLE tracking_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    location VARCHAR,
    status VARCHAR,
    description TEXT,
    event_timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;

-- 4. Customer Policies (Public Read)
CREATE POLICY "Public can view shipments" ON shipments FOR SELECT USING (true);
CREATE POLICY "Public can view events" ON tracking_events FOR SELECT USING (true);

-- 5. Admin Policies (Authenticated Write/Read)
CREATE POLICY "Admins can manage shipments" ON shipments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can manage events" ON tracking_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
