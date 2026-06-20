export function iceServers() {
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
  const stunUrl = process.env.LIGHTCURVE_STUN_URL?.trim();
  const turnUrl = process.env.LIGHTCURVE_TURN_URL?.trim();
  if (stunUrl) servers.push({ urls: stunUrl });
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.LIGHTCURVE_TURN_USERNAME?.trim(),
      credential: process.env.LIGHTCURVE_TURN_CREDENTIAL?.trim(),
    });
  }
  return servers;
}
