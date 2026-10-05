// Supabase project settings (Supabase → Project Settings → API).
// The anon key is public by design; Row Level Security protects the data.
export const SUPABASE_URL = 'https://utiigqutuglcwnxsjkpq.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0aWlncXV0dWdsY3dueHNqa3BxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNjY4MTcsImV4cCI6MjEwNjc0MjgxN30.VP6R5uylFP1l0bSTCdRerI10sya0Ze6h0FCscRiaX2c';

// Only these email domains may sign in (checked in the browser and in the Edge Function).
export const ALLOWED_EMAIL_DOMAIN = 'adkhospital.com';
