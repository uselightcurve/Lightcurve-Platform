export async function createRoom(runId: string) {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) throw new Error('DAILY_API_KEY is not set');

  const response = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: `run-${runId}-${Date.now()}`,
      properties: {
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
        is_owner_only_broadcast: false,
        enable_recording: 'cloud',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Daily.co API error: ${await response.text()}`);
  }
  return response.json();
}

export async function deleteRoom(roomName: string) {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return;

  await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}
