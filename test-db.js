const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const html = fs.readFileSync('frontend/supabase-config.js', 'utf8');
const urlMatch = html.match(/supabaseUrl\s*=\s*["']([^"']+)["']/);
const keyMatch = html.match(/supabaseKey\s*=\s*["']([^"']+)["']/);

const supabase = createClient(urlMatch[1], keyMatch[1]);

async function run() {
    const {data, error} = await supabase.from('shipments').select('*').eq('tracking_number', 'TRK-NI-20260904-E2JIQX');
    console.log(data, error);
}
run();
