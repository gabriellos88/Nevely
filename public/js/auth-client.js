const authConfiguration = window.__AUTH_CONFIG__ || {};

if (window.history && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function clearAuthError() {
  const feedback = document.getElementById('auth-error');
  if (!feedback) return;
  feedback.textContent = '';
  feedback.hidden = true;
}

function showAuthError(message) {
  if (!message) return;
  let feedback = document.getElementById('auth-error');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'auth-error';
    feedback.className = 'auth-error';
    feedback.setAttribute('role', 'alert');
    document.querySelector('.auth-entry__header')?.after(feedback);
  }
  feedback.textContent = message;
  feedback.hidden = false;
}

window.handleGoogleCredential = async ({ credential } = {}) => {
  if (!credential) return;
  const form = document.querySelector('.auth-form');
  clearAuthError();
  const values = form ? Object.fromEntries(new FormData(form)) : {};
  try {
    const response = await fetch('/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': authConfiguration.csrfToken || ''
      },
      body: JSON.stringify({
        ...values,
        credential,
        claim: authConfiguration.claimMode ? '1' : undefined,
        profileCompletion: authConfiguration.googleProfileRequired ? '1' : undefined
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 422
        && data.code === 'GOOGLE_PROFILE_REQUIRED'
        && !authConfiguration.googleProfileRequired) {
        window.scrollTo?.(0, 0);
        window.location.replace(`/register?google=profile-required${authConfiguration.claimMode ? '&claim=1' : ''}`);
        return;
      }
      if (response.status === 422
        && data.code === 'GOOGLE_PROFILE_REQUIRED'
        && authConfiguration.googleProfileRequired) {
        form?.querySelector(':invalid')?.focus();
        return;
      }
      throw new Error(data.error || 'Google sign-in could not be completed.');
    }
    if (data.twoFactorRequired) {
      window.location.replace('/login/2fa');
      return;
    }
    if (data.profileCompletionRequired) {
      window.location.replace('/complete-profile');
      return;
    }
    if (data.adminTwoFactorSetupRequired) {
      window.location.replace('/admin/security');
      return;
    }
    window.location.replace('/chat');
  } catch (error) {
    showAuthError(error.message);
  }
};

window.lucide?.createIcons();
