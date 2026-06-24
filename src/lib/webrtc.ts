export function iceServers() {
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
  const stunUrl = process.env.LIGHTCURVE_STUN_URL?.trim();
  const turnUrl = process.env.LIGHTCURVE_TURN_URL?.trim();
  const turnUsername = process.env.LIGHTCURVE_TURN_USERNAME?.trim();
  const turnCredential = process.env.LIGHTCURVE_TURN_CREDENTIAL?.trim();

  if (stunUrl) servers.push({ urls: stunUrl });
  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }
  return servers;
}
