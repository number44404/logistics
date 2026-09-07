-- Alter admin_devices to handle full web push subscriptions and link to staff_users
ALTER TABLE admin_devices ALTER COLUMN device_token TYPE TEXT;
ALTER TABLE admin_devices ADD COLUMN IF NOT EXISTS push_subscription JSONB;

-- Re-establish RLS for strict security (only auth.uid())
DROP POLICY IF EXISTS "Admin full access devices" ON admin_devices;

CREATE POLICY "Users can manage their own devices" ON admin_devices 
FOR ALL TO authenticated 
USING (admin_id = auth.uid()) 
WITH CHECK (admin_id = auth.uid());
