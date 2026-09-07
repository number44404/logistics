// Supabase Configuration
const SUPABASE_URL = 'https://mgspwlinojjuvctemnah.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nc3B3bGlub2pqdXZjdGVtbmFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0Njk4ODEsImV4cCI6MjEwNDA0NTg4MX0.c_ADOigXTMlkdAbUfbZgzrP27K4FPsxVDEc2BawGANM';

// Initialize Supabase Client
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
