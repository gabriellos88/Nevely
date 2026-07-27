const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
const feedback = document.getElementById('adminSecurityFeedback');

async function securityApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The security action failed.');
  return data;
}

document.getElementById('resendAdminVerification')?.addEventListener('click', async () => {
  try {
    const data = await securityApi('/api/auth/verification/resend', {
      method: 'POST',
      body: '{}'
    });
    feedback.textContent = data.message;
  } catch (error) {
    feedback.textContent = error.message;
  }
});

document.getElementById('adminTwoFactorSetup')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const data = await securityApi('/api/admin/2fa/setup', {
      method: 'POST',
      body: JSON.stringify(values)
    });
    document.getElementById('adminTwoFactorSecretValue').textContent = data.secret;
    document.getElementById('adminTwoFactorSecret').classList.remove('hidden');
    feedback.textContent = '';
  } catch (error) {
    feedback.textContent = error.message;
  }
});

document.getElementById('adminTwoFactorConfirm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await securityApi('/api/admin/2fa/confirm', {
      method: 'POST',
      body: JSON.stringify(values)
    });
    window.location.assign('/admin');
  } catch (error) {
    feedback.textContent = error.message;
  }
});
