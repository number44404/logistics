-- ==========================================
-- SUPABASE V6 MIGRATION: RECEIVER LINK RLS FIX
-- ==========================================

-- 1. Allow public (anonymous receivers) to insert their details into the receivers table
CREATE POLICY "Public insert receivers" ON receivers FOR INSERT TO anon WITH CHECK (true);

-- 2. Allow public to update shipments, BUT ONLY if the shipment is currently a Draft
CREATE POLICY "Public update draft shipments" ON shipments FOR UPDATE TO anon USING (is_draft = true) WITH CHECK (true);

-- 3. Allow public to create the first tracking event when completing the form
CREATE POLICY "Public insert tracking events" ON tracking_events FOR INSERT TO anon WITH CHECK (true);
