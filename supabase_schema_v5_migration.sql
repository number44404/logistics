-- ==========================================
-- SUPABASE V5 MIGRATION: DUAL WORKFLOW & DRAFTS
-- ==========================================

-- 1. ADD DRAFT FLAG TO SHIPMENTS
ALTER TABLE shipments 
ADD COLUMN is_draft BOOLEAN DEFAULT false;

-- 2. MAKE RECEIVER_ID NULLABLE (if not already)
ALTER TABLE shipments 
ALTER COLUMN receiver_id DROP NOT NULL;

-- 3. UPDATE EXISTING RECORDS
UPDATE shipments 
SET is_draft = false 
WHERE is_draft IS NULL;

-- 4. CREATE RECEIVER LINKS TABLE
CREATE TABLE receiver_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    secure_token UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    status VARCHAR DEFAULT 'active', -- 'active', 'completed', 'expired'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. RLS POLICIES FOR RECEIVER LINKS
ALTER TABLE receiver_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access receiver_links" ON receiver_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public read receiver_links" ON receiver_links FOR SELECT TO anon USING (true);
CREATE POLICY "Public update receiver_links" ON receiver_links FOR UPDATE TO anon USING (true);
