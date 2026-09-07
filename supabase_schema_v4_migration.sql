-- ==========================================
-- SUPABASE V4 MIGRATION: ADVANCED LOGISTICS
-- ==========================================

-- 1. ADD NEW LOGISTICS COLUMNS TO SHIPMENTS
ALTER TABLE shipments 
ADD COLUMN billing_party VARCHAR DEFAULT 'Sender',
ADD COLUMN customer_reference VARCHAR,
ADD COLUMN origin_facility VARCHAR,
ADD COLUMN destination_facility VARCHAR;

-- 2. UPDATE EXISTING RECORDS WITH DEFAULT VALUES
UPDATE shipments 
SET billing_party = 'Sender' 
WHERE billing_party IS NULL;

-- 3. OPTIONAL: To support multi-package in the future
-- ALTER TABLE packages ADD COLUMN shipment_id UUID REFERENCES shipments(id);
