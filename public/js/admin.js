const uiCopy = window.__COPY__;
const adminConfiguration = window.__ADMIN_CONFIG__ || {};

async function adminApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': adminConfiguration.csrfToken
        || document.querySelector('meta[name="csrf-token"]')?.content
        || '',
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || uiCopy.admin.actionFailed);
  return data;
}

document.querySelectorAll('[data-report-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const resolution = prompt(uiCopy.admin.resolutionPrompt) || '';
    await adminApi(`/api/admin/reports/${button.dataset.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: button.dataset.reportAction, resolution })
    });
    window.location.reload();
  });
});

document.querySelectorAll('[data-ban]').forEach((button) => {
  button.addEventListener('click', async () => {
    const reason = prompt(uiCopy.admin.banReasonPrompt);
    if (reason === null) return;
    await adminApi(`/api/admin/users/${button.dataset.id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ type: button.dataset.ban, hours: 24, reason })
    });
    alert(uiCopy.admin.banCreated);
  });
});

document.querySelectorAll('[data-delete-user]').forEach((button) => {
  button.addEventListener('click', async () => {
    const confirmation = prompt(uiCopy.admin.deletePrompt);
    if (confirmation !== 'BAN AND DELETE') return;
    await adminApi(`/api/admin/users/${button.dataset.id}`, {
      method: 'DELETE', body: JSON.stringify({ confirmation })
    });
    window.location.reload();
  });
});

document.getElementById('adminPriceForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await adminApi('/api/admin/prices', { method: 'POST', body: JSON.stringify(values) });
  window.location.reload();
});

document.getElementById('adminReauthForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (adminConfiguration.reauthMethod !== 'password') return;
  const feedback = document.getElementById('adminReauthFeedback');
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await adminApi('/api/admin/reauth', {
      method: 'POST',
      body: JSON.stringify(values)
    });
    feedback.textContent = uiCopy.admin.reauthenticationComplete;
  } catch (error) {
    feedback.textContent = error.message;
  }
});

window.handleAdminGoogleReauth = async ({ credential } = {}) => {
  if (adminConfiguration.reauthMethod !== 'google' || !credential) return;
  const form = document.getElementById('adminReauthForm');
  const feedback = document.getElementById('adminReauthFeedback');
  if (!form?.reportValidity()) return;
  try {
    const values = Object.fromEntries(new FormData(form));
    await adminApi('/api/admin/reauth', {
      method: 'POST',
      body: JSON.stringify({ ...values, credential })
    });
    feedback.textContent = uiCopy.admin.reauthenticationComplete;
  } catch (error) {
    feedback.textContent = error.message;
  }
};
