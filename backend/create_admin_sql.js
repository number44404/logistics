const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function createAdmin() {
    console.log("Since anon key can't insert admins directly via API, use this SQL in Supabase Dashboard:");
    console.log(`
-- Run this in your Supabase SQL Editor to manually insert the admin profile
-- (You must first sign up admin@gmail.com / 123456 on the frontend to generate the auth.users row)

INSERT INTO admins (user_id, email, name, role)
SELECT id, email, 'System Admin', 'admin' 
FROM auth.users 
WHERE email = 'admin@gmail.com';
    `);
}

createAdmin();
