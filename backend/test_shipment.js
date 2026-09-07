require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function runTest() {
    console.log("1. Starting Test...");

    // 1. Admin Login
    console.log("2. Attempting Admin Login...");
    // Read test admin credentials from somewhere? Let's just create a shipment using the anon key, 
    // wait, shipments table might have RLS!
    // Let me check if RLS is strictly enforced for insert.
    // In previous steps, the user had an RLS issue creating admins, so RLS might be on.
    
    // Instead of full login which needs a known password, I will just do a direct service_role insertion if available, 
    // OR we can just check if RLS blocks it. Wait, the anon key is used by the customer to track.
    
    const trackingNumber = `TRK-TEST-${Date.now()}`;
    
    console.log("3. Inserting Shipment...");
    const payload = {
        tracking_number: trackingNumber,
        customer_name: "Test User",
        origin_city: "New York",
        destination_city: "London",
        package_weight: "10 lbs",
        status: "Pending",
        estimated_delivery: "2026-10-10"
    };

    const { data: newShipment, error: insertError } = await supabase
        .from('shipments')
        .insert([payload])
        .select()
        .single();
        
    if (insertError) {
        console.error("Failed to insert shipment:", insertError.message);
        console.log("Note: This might be due to RLS blocking anonymous inserts (which is good!). Admin login required.");
        return;
    }
    
    console.log("Shipment inserted:", newShipment.id);

    console.log("4. Inserting Tracking Event...");
    const { error: eventError } = await supabase
        .from('tracking_events')
        .insert([{
            shipment_id: newShipment.id,
            status: 'Pending',
            location: 'New York',
            description: 'Shipment created.'
        }]);

    if (eventError) {
        console.error("Failed to insert event:", eventError.message);
    } else {
        console.log("Tracking event created.");
    }
    
    console.log("5. Testing Customer Lookup...");
    const { data: lookupData, error: lookupError } = await supabase
        .from('shipments')
        .select('*, tracking_events(*)')
        .eq('tracking_number', trackingNumber)
        .single();
        
    if (lookupError) {
        console.error("Lookup failed:", lookupError.message);
    } else {
        console.log("Lookup successful. Found tracking events:", lookupData.tracking_events.length);
    }
    
    // Cleanup
    await supabase.from('shipments').delete().eq('id', newShipment.id);
    console.log("Test data cleaned up.");
}

runTest();
