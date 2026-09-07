const fs = require('fs');

let code = fs.readFileSync('backend/push_listener.js', 'utf8');

// Replace ANON_KEY definition with SERVICE_ROLE_KEY definition
code = code.replace(
  "const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || envConfig.SUPABASE_ANON_KEY;",
  "const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envConfig.SUPABASE_SERVICE_ROLE_KEY;"
);

// Replace supabase initialization
code = code.replace(
  "const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);",
  "const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);"
);

// Remove the signInWithPassword block completely
code = code.replace(/console\.log\("Authenticating push listener service\.\.\."\);\s*const \{ error: authError \} = await supabase\.auth\.signInWithPassword\(\{\s*email: 'admin@gmail\.com',\s*password: 'password123456'\s*\}\);\s*if \(authError\) \{\s*console\.error\("Failed to authenticate listener:", authError\.message\);\s*return;\s*\}\s*console\.log\("Authenticated\."\);/, "");

fs.writeFileSync('backend/push_listener.js', code);
