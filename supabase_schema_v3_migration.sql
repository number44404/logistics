-- ==========================================
-- SUPABASE V3 MIGRATION: LOGISTICS DATA MODEL
-- ==========================================

-- 1. CREATE NEW TABLES
CREATE TABLE senders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR NOT NULL,
    company_name VARCHAR,
    email VARCHAR,
    phone VARCHAR,
    country VARCHAR,
    city VARCHAR,
    address VARCHAR,
    postal_code VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE receivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR NOT NULL,
    company_name VARCHAR,
    email VARCHAR,
    phone VARCHAR,
    country VARCHAR,
    city VARCHAR,
    address VARCHAR,
    postal_code VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_type VARCHAR DEFAULT 'Box',
    description TEXT,
    weight NUMERIC,
    length NUMERIC,
    width NUMERIC,
    height NUMERIC,
    declared_value NUMERIC,
    number_of_items INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. ADD NEW COLUMNS TO SHIPMENTS
ALTER TABLE shipments 
ADD COLUMN sender_id UUID REFERENCES senders(id),
ADD COLUMN receiver_id UUID REFERENCES receivers(id),
ADD COLUMN package_id UUID REFERENCES packages(id),
ADD COLUMN shipping_method VARCHAR DEFAULT 'Standard';

-- 3. MIGRATE EXISTING DATA (PL/pgSQL Block)
DO $$
DECLARE
    ship RECORD;
    s_id UUID;
    r_id UUID;
    p_id UUID;
BEGIN
    FOR ship IN SELECT * FROM shipments LOOP
        -- Create sender from legacy fields
        INSERT INTO senders (full_name, email, phone, country, city) 
        VALUES (COALESCE(ship.customer_name, 'Unknown Sender'), ship.customer_email, ship.customer_phone, ship.origin_country, ship.origin_city)
        RETURNING id INTO s_id;

        -- Create receiver from legacy fields
        INSERT INTO receivers (full_name, country, city) 
        VALUES ('Unknown Receiver', ship.destination_country, ship.destination_city)
        RETURNING id INTO r_id;

        -- Create package from legacy fields
        INSERT INTO packages (description, weight) 
        VALUES (ship.package_description, COALESCE(NULLIF(regexp_replace(ship.package_weight, '[^0-9.]', '', 'g'), ''), '0')::NUMERIC)
        RETURNING id INTO p_id;

        -- Link IDs to shipment
        UPDATE shipments 
        SET sender_id = s_id, receiver_id = r_id, package_id = p_id
        WHERE id = ship.id;
    END LOOP;
END $$;

-- 4. CLEANUP LEGACY COLUMNS
-- Only execute this if you are absolutely sure!
ALTER TABLE shipments
DROP COLUMN customer_name,
DROP COLUMN customer_email,
DROP COLUMN customer_phone,
DROP COLUMN package_description,
DROP COLUMN package_weight,
DROP COLUMN origin_country,
DROP COLUMN origin_city,
DROP COLUMN destination_country,
DROP COLUMN destination_city;

-- 5. RLS POLICIES FOR NEW TABLES
ALTER TABLE senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access senders" ON senders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins full access receivers" ON receivers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins full access packages" ON packages FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public read senders" ON senders FOR SELECT TO anon USING (true);
CREATE POLICY "Public read receivers" ON receivers FOR SELECT TO anon USING (true);
CREATE POLICY "Public read packages" ON packages FOR SELECT TO anon USING (true);
