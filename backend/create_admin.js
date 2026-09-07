const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function createAdmin() {
    console.log("Attempting to create admin account...");
    
    // 1. Sign up the user in auth.users
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email: 'admin@gmail.com',
        password: 'password123456'
    });

    if (authError) {
        console.error("Auth Error:", authError.message);
        return;
    }

    console.log("Auth user created successfully.");

    // 2. Insert into our public admins table
    const { error: dbError } = await supabase
        .from('admins')
        .insert([
            {
                user_id: authData.user.id,
                email: 'admin@gmail.com',
                name: 'System Admin',
                role: 'admin'
            }
        ]);

    if (dbError) {
        console.error("Database Error:", dbError.message);
    } else {
        console.log("Admin successfully registered and verified in the database!");
    }
}

createAdmin();
