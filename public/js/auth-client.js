const authConfiguration = window.__AUTH_CONFIG__ || {};

window.handleGoogleCredential = async ({ credential } = {}) => {
  if (!credential) return;
  const form = document.querySelector('.auth-form');
  const feedback = document.getElementById('auth-error') || document.createElement('div');
  if (!feedback.id) {
    feedback.id = 'auth-error';
    feedback.className = 'auth-error';
    feedback.setAttribute('role', 'alert');
    document.querySelector('.auth-entry__header')?.after(feedback);
  }
  const values = form ? Object.fromEntries(new FormData(form)) : {};
  try {
    const response = await fetch('/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': authConfiguration.csrfToken || ''
      },
      body: JSON.stringify({ ...values, credential })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Google sign-in could not be completed.');
    window.location.assign('/chat');
  } catch (error) {
    feedback.textContent = error.message;
  }
};

window.lucide?.createIcons();
