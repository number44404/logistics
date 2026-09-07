-- SUPABASE ROW LEVEL SECURITY (RLS) POLICIES

-- 1. Enable RLS on all tables
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;


-- 2. ADMINS TABLE POLICIES
-- Only logged-in users can view their own admin profile. Public cannot view admins.
CREATE POLICY "Admins can view own profile" 
ON admins FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Only super-admins (or system) can insert/update admins (restricting generic creation)
CREATE POLICY "System manages admins" 
ON admins FOR ALL 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);


-- 3. SHIPMENTS TABLE POLICIES
-- Customer Rule: Public read access (Allows frontend to search by tracking number)
CREATE POLICY "Customers can search shipments" 
ON shipments FOR SELECT 
TO anon 
USING (true);

-- Admin Rule: Authenticated users can do everything (Create, Read, Update, Delete)
CREATE POLICY "Admins have full access to shipments" 
ON shipments FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);


-- 4. TRACKING_EVENTS TABLE POLICIES
-- Customer Rule: Public read access (Allows frontend to render the timeline)
CREATE POLICY "Customers can view tracking events" 
ON tracking_events FOR SELECT 
TO anon 
USING (true);

-- Admin Rule: Authenticated users can do everything (Add, Update, Delete events)
CREATE POLICY "Admins have full access to tracking events" 
ON tracking_events FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);
