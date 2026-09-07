const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
let env = {};
fs.readFileSync('../.env','utf8').split('\n').forEach(l => { 
  const m = l.match(/^([^=]+)=(.*)$/); if(m) env[m[1].trim()]=m[2].trim(); 
});
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

async function test() {
  const token = 'ebb4f31e-42fb-4e37-ae34-5c0ecfb72957';
  const { data: linkData, error: linkError } = await supabase
      .from('receiver_links')
      .select('*, shipments(*, senders(full_name, city, country), packages(*))')
      .eq('secure_token', token)
      .single();

  if (linkError) return console.error('Link error:', linkError);
  
  const shipment = linkData.shipments;
  console.log('Shipment ID:', shipment.id);
  console.log('Shipping Fee:', shipment.shipping_fee);

  // simulate loadPaymentMethods
  const { data: methods, error } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });
      
  console.log('Payment Methods:', methods.map(m => m.type));
}

test();
