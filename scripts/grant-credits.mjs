const [email, minutesInput, actionsInput, ...noteParts] = process.argv.slice(2);
const baseUrl = (process.env.LIGHTCURVE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
const token = process.env.ADMIN_CREDITS_TOKEN;
const minutes = Number(minutesInput);
const actions = Number(actionsInput);

if (!baseUrl || !token || !email || !Number.isFinite(minutes) || !Number.isFinite(actions)) {
  console.error('Usage: ADMIN_CREDITS_TOKEN=... LIGHTCURVE_BASE_URL=https://app.example.com npm run admin:grant-credits -- user@example.com 5000 25000 "optional note"');
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/admin/credits`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email,
    minutes,
    actions,
    note: noteParts.join(' '),
  }),
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(body.error || `Credit grant failed with ${response.status}.`);
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));
