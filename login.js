/* ==========================================================================
   login.js — sign-in / sign-up form behavior for login.html
   Depends on auth.js being loaded first.
   ========================================================================== */

(async function(){
  const msgEl = document.getElementById('auth-msg');
  const form = document.getElementById('login-form');
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');
  const submitBtn = document.getElementById('submit-btn');
  const toggleLink = document.getElementById('toggle-mode');
  const modeLabel = document.getElementById('mode-label');
  const modeSub = document.getElementById('mode-sub');
  const forgotLink = document.getElementById('forgot-link');

  let mode = 'signin';

  function showMsg(text, kind){
    msgEl.textContent = text;
    msgEl.className = 'auth-msg' + (kind ? ' ' + kind : '');
    msgEl.style.display = text ? 'block' : 'none';
  }

  // Surface a Supabase error redirected back in the URL hash — e.g. an
  // expired or already-used email confirmation link:
  // #error=access_denied&error_description=...
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if(hashParams.get('error_description')){
    showMsg(decodeURIComponent(hashParams.get('error_description').replace(/\+/g, ' ')), 'err');
  }

  // Already signed in (existing session, or one just recovered from the
  // URL by auth.js)? Skip straight to the dashboard.
  const existing = await getCurrentSession();
  if(existing){
    window.location.href = 'dashboard.html';
    return;
  }

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    mode = mode === 'signin' ? 'signup' : 'signin';
    if(mode === 'signup'){
      modeLabel.textContent = 'Create your account.';
      modeSub.textContent = "Free to sign up. We'll email you a confirmation link — click it before logging in.";
      submitBtn.textContent = 'Create Account →';
      toggleLink.textContent = 'Already have an account? Log in';
    } else {
      modeLabel.textContent = 'Clock in.';
      modeSub.textContent = 'Log in to your LoadParse account for unlimited parsing.';
      submitBtn.textContent = 'Enter Dashboard →';
      toggleLink.textContent = 'Need an account? Create one';
    }
    showMsg('', '');
  });

  forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    showMsg("Password reset isn't wired up yet in this build — see the README for what's needed to finish it.", 'err');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    const password = passwordEl.value;

    if(!email || !password){ showMsg('Enter an email and password.', 'err'); return; }
    if(password.length < 6){ showMsg('Password must be at least 6 characters.', 'err'); return; }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Please wait…';
    showMsg('', '');

    try{
      if(mode === 'signup'){
        const { data, error } = await signUpWithEmail(email, password);
        if(error){ showMsg(error.message, 'err'); return; }
        if(data.session){
          // Email confirmation is disabled on this project — session is live immediately.
          window.location.href = 'dashboard.html';
        } else {
          showMsg('Account created — check your email to confirm it, then log in.', 'ok');
        }
      } else {
        const { data, error } = await signInWithEmail(email, password);
        if(error){ showMsg(error.message, 'err'); return; }
        window.location.href = 'dashboard.html';
      }
    } catch(err){
      showMsg('Something went wrong: ' + err.message, 'err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
})();
