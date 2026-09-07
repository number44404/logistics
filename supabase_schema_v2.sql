-- SUPABASE DATABASE SCHEMA V2

-- 1. ADMINS TABLE
-- Purpose: Store admin roles.
CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR,
    email VARCHAR UNIQUE NOT NULL,
    role VARCHAR DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup by auth user
CREATE INDEX idx_admins_user_id ON admins(user_id);

-- 2. SHIPMENTS TABLE
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

-- Index for fast tracking lookups by customers
CREATE INDEX idx_shipments_tracking_number ON shipments(tracking_number);

-- 3. TRACKING_EVENTS TABLE
CREATE TABLE tracking_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE NOT NULL,
    status VARCHAR,
    location VARCHAR,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fetching all events of a specific shipment quickly
CREATE INDEX idx_tracking_events_shipment_id ON tracking_events(shipment_id);
