-- Add fields necessary for Android/PWA dual platform push architecture
-- Adds updated_at to track token refreshes (essential for Android FCM tokens)
-- Adds is_active to allow safe invalidation of failing tokens without immediate deletion

ALTER TABLE admin_devices
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
