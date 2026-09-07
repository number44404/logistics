const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
let envConfig = {};
try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    envFile.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) envConfig[match[1].trim()] = match[2].trim();
    });
} catch (e) {}
const supabase = createClient(envConfig.SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('exec_sql', { sql: 'ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS attachment_url TEXT;' });
  if (error) console.log("RPC Error", error);
  console.log("Done");
}
run();
