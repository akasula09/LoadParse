/* ==========================================================================
   auth.js — Supabase Auth for LoadParse
   Shared by login.html and dashboard.html.

   Requires the Supabase JS CDN script loaded BEFORE this file:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

   Project ref:  pquwgzwbdhwmnsjsodni
   Key type:     publishable key (safe to expose client-side — this is the
                 new-style Supabase key that replaces the old "anon" key,
                 NOT the secret/service_role key).
   ========================================================================== */

const SUPABASE_URL = 'https://pquwgzwbdhwmnsjsodni.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WciVAE3r35hMRLtZ_rjn5w_3D7lpYFY';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Reads the access/refresh token Supabase appends to the URL after an
    // email-confirmation or magic-link redirect, establishes the session
    // from it, then strips it from the address bar. This is "looking for
    // the token" — it happens automatically on whichever page the
    // confirmation link lands on (dashboard.html, per emailRedirectTo below).
    detectSessionInUrl: true,
  },
});

/** Current session, if any. Calling this is also what triggers the
 *  URL-token detection above on first load. */
async function getCurrentSession(){
  const { data, error } = await sb.auth.getSession();
  if(error){ console.error('[auth] getSession error', error); return null; }
  return data.session || null;
}

function onAuthChange(callback){
  sb.auth.onAuthStateChange((_event, session) => callback(session));
}

async function signUpWithEmail(email, password){
  return sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + '/dashboard.html' },
  });
}

async function signInWithEmail(email, password){
  return sb.auth.signInWithPassword({ email, password });
}

async function signOut(){
  await sb.auth.signOut();
}
