/* config.js — conexión pública a Supabase.
 *
 * La clave `anon` es pública por diseño: solo permite lo que las políticas RLS
 * autoricen. La `service_role` NUNCA va en el frontend.
 */
window.TS_CONFIG = {
  SUPABASE_URL: 'https://hnpjkaiylibjnrqgfiku.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhucGprYWl5bGliam5ycWdmaWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNjEzOTgsImV4cCI6MjEwODYzNzM5OH0.IN0Bg85dtFtib0_gYw1RvKI_wJj6oIBjo8msGaRo71c',
  CURRENCY: 'USD',
  STORE_NAME: 'TechStore SV',
  WHATSAPP: '',
};
