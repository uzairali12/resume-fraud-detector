// ================================================================
// auth.js — Supabase Authentication
// Handles: Google, GitHub, Microsoft OAuth + Email/Password
// ================================================================

// ── CONFIG ────────────────────────────────────────────────────
// The ANON key is intentionally public — it's safe in frontend JS.
// Supabase Row Level Security (RLS) protects your data.
// NEVER put SUPABASE_JWT_SECRET here — that stays in Railway only.

const SUPABASE_URL      = 'https://uygmvinepffbxfpblvra.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_q07H8qPV14nMqIFoS8qvkg_JqBqtzGv'
// ↑ Replace with your actual anon key from:
//   Supabase Dashboard → Settings → API → "anon public"

// ── INIT ──────────────────────────────────────────────────────

const { createClient } = supabase
const _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let _authMode = 'signin'   // 'signin' | 'signup'

// ── AUTH STATE LISTENER ───────────────────────────────────────
// Fires on: page load (restores session), sign in, sign out,
// and after OAuth redirect callback.

_sb.auth.onAuthStateChange((event, session) => {
  const user = session?.user ?? null
  _updateNavbar(user)

  if (event === 'SIGNED_IN' && user) {
    closeAuth()
    // If the user was on the landing page, take them to the app
    const landingEl = document.getElementById('view-landing')
    if (landingEl && !landingEl.classList.contains('hidden')) {
      navigateTo('dashboard')
    }
  }

  if (event === 'SIGNED_OUT') {
    navigateTo('landing')
  }
})

// ── NAVBAR STATE ──────────────────────────────────────────────

function _updateNavbar(user) {
  const navUser   = document.getElementById('nav-user')
  const navSignin = document.getElementById('nav-signin')
  const navLinks  = document.getElementById('nav-links')
  const avatar    = document.getElementById('user-avatar')
  const nameEl    = document.getElementById('user-name')

  if (user) {
    navUser.classList.remove('hidden')
    navSignin.classList.add('hidden')
    navLinks.classList.remove('hidden')

    const meta = user.user_metadata || {}
    const displayName = meta.full_name || meta.name || user.email?.split('@')[0] || 'User'
    nameEl.textContent = displayName

    // Use OAuth avatar if available, fall back to DiceBear initials
    avatar.src = meta.avatar_url
      || `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=7C6EF5&textColor=ffffff`
    avatar.onerror = () => {
      avatar.src = `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=7C6EF5&textColor=ffffff`
    }
  } else {
    navUser.classList.add('hidden')
    navSignin.classList.remove('hidden')
    navLinks.classList.add('hidden')
  }
}

// ── OAUTH PROVIDERS ───────────────────────────────────────────

async function signInWithGoogle() {
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { access_type: 'offline', prompt: 'select_account' }
    }
  })
  if (error) _showAuthError(error.message)
}

async function signInWithGitHub() {
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin }
  })
  if (error) _showAuthError(error.message)
}

async function signInWithMicrosoft() {
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo: window.location.origin,
      scopes: 'email openid profile'
    }
  })
  if (error) _showAuthError(error.message)
}

// ── EMAIL AUTH ────────────────────────────────────────────────

async function handleEmailAuth(e) {
  e.preventDefault()

  const email    = document.getElementById('auth-email').value.trim()
  const password = document.getElementById('auth-password').value
  const submitBtn = document.getElementById('auth-submit-btn')

  submitBtn.disabled = true
  submitBtn.textContent = _authMode === 'signin' ? 'Signing in…' : 'Creating account…'
  _hideAuthError()

  let error

  if (_authMode === 'signin') {
    ;({ error } = await _sb.auth.signInWithPassword({ email, password }))

  } else {
    const nameInput = document.getElementById('auth-name')
    const fullName  = nameInput?.value?.trim() || ''
    ;({ error } = await _sb.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    }))
    if (!error) {
      _showAuthError(
        'Check your email inbox to confirm your account, then sign in.',
        'info'
      )
      submitBtn.disabled = false
      submitBtn.textContent = 'Sign Up'
      return
    }
  }

  submitBtn.disabled = false
  submitBtn.textContent = _authMode === 'signin' ? 'Sign In' : 'Sign Up'

  if (error) _showAuthError(error.message)
}

// ── TOGGLE SIGN IN ↔ SIGN UP ──────────────────────────────────

function toggleAuthMode() {
  _authMode = _authMode === 'signin' ? 'signup' : 'signin'
  const isSignup = _authMode === 'signup'

  document.getElementById('auth-submit-btn').textContent  = isSignup ? 'Sign Up' : 'Sign In'
  document.getElementById('auth-switch-label').textContent = isSignup ? 'Already have an account?' : "Don't have an account?"
  document.getElementById('auth-switch-link').textContent  = isSignup ? ' Sign in' : ' Sign up free'
  document.getElementById('name-field').classList.toggle('hidden', !isSignup)
  document.getElementById('modal-sub').textContent = isSignup
    ? 'Create your account to save analyses'
    : 'Sign in to save your analyses'

  _hideAuthError()
}

// ── SIGN OUT ──────────────────────────────────────────────────

async function signOut() {
  await _sb.auth.signOut()
  showToast('Signed out successfully', 'info')
}

// ── MODAL OPEN / CLOSE ────────────────────────────────────────

function openAuth() {
  document.getElementById('modal-auth').classList.remove('hidden')
  setTimeout(() => document.getElementById('auth-email')?.focus(), 100)
}

function closeAuth() {
  document.getElementById('modal-auth').classList.add('hidden')
  _hideAuthError()
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-auth')) closeAuth()
}

// Close modal on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAuth()
})

// ── HELPERS ───────────────────────────────────────────────────

function _showAuthError(msg, type = 'error') {
  const el = document.getElementById('auth-error')
  el.textContent = msg
  el.classList.remove('hidden')
  if (type === 'info') {
    el.style.background = 'var(--accent-dim)'
    el.style.borderColor = 'rgba(124,110,245,0.4)'
    el.style.color = '#A78BFA'
  } else {
    el.style.background = ''
    el.style.borderColor = ''
    el.style.color = ''
  }
}

function _hideAuthError() {
  document.getElementById('auth-error').classList.add('hidden')
}

// ── EXPORTED HELPERS (used by app.js) ─────────────────────────

async function getCurrentUser() {
  const { data } = await _sb.auth.getUser()
  return data?.user ?? null
}

async function getAccessToken() {
  const { data } = await _sb.auth.getSession()
  return data?.session?.access_token ?? null
}