-- Allow anon to update shipment to add payment receipt IF payment_status is unpaid
CREATE POLICY "Public update unpaid shipments" ON shipments 
FOR UPDATE TO anon 
USING (payment_status = 'unpaid') 
WITH CHECK (true);
