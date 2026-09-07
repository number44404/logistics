-- Add payment method and details for comprehensive payment flow
ALTER TABLE shipments 
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
ADD COLUMN IF NOT EXISTS payment_details TEXT;
