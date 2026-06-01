let currentSessionId = null;

async function startSession() {
  const phone = document.getElementById('phone').value.trim();
  if (!phone) return alert('Enter phone number');

  const res = await fetch('/start-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: phone })
  });

  const data = await res.json();
  if (data.success) {
    currentSessionId = data.sessionId;
    document.getElementById('code').textContent = data.pairingCode;
    document.getElementById('result').classList.remove('hidden');
    alert('Enter the pairing code in WhatsApp!');
  } else {
    alert(data.error || 'Error');
  }
}

async function checkStatus() {
  if (!currentSessionId) return;
  const res = await fetch(`/status/${currentSessionId}`);
  const data = await res.json();
  alert(data.connected ? 'Connected! You can download now.' : 'Not connected yet. Try again in a few seconds.');
}

async function downloadSession() {
  if (!currentSessionId) return;
  window.location.href = `/download-session/${currentSessionId}`;
}
