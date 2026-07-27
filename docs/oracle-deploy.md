# Oracle Always Free deployment

This deployment runs Lightcurve on one Oracle Cloud VM with Docker Compose:

- `web`: the Next.js app
- `mos`: ViSQOL/DNSMOS audio scoring
- `postgres`: the app database
- `audio_data`: private local audio storage shared by `web` and `mos`

Oracle Cloud Free Tier includes Always Free compute services for an unlimited period, subject to account and capacity limits. Oracle may suspend or terminate accounts left idle for 30 days or more, so keep a small health check or regular login cadence.

Sources:

- Oracle Free Tier: https://www.oracle.com/cloud/free/
- Docker Engine on Ubuntu: https://docs.docker.com/engine/install/ubuntu/

## 1. Create the Oracle VM

1. Sign in to Oracle Cloud and create an Always Free eligible VM.
2. Prefer an Arm-based Ampere A1 Ubuntu image if capacity is available.
3. Open inbound ports in the VCN security list or NSG:
   - TCP `22` from your IP only
   - TCP `80` from the internet
   - TCP `443` from the internet when you add HTTPS
4. Reserve the public IP if this will become a real app URL.

## 2. Install Docker on the VM

SSH into the VM, then install Docker using Docker's Ubuntu guide. After Docker is installed:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

## 3. Copy the app and fill secrets

```bash
git clone <YOUR_REPO_URL> lightcurve
cd lightcurve
cp .env.oracle.example .env.oracle
nano .env.oracle
```

Fill at minimum:

- `POSTGRES_PASSWORD`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `GEMINI_API_KEY`
- `MOS_SERVICE_TOKEN`
- `SCORING_INGEST_TOKEN`
- `LIGHTCURVE_CREDENTIAL_SECRET`

Generate the three token-style values with:

```bash
openssl rand -hex 32
```

## 4. Start the stack

```bash
docker compose --env-file .env.oracle -f docker-compose.oracle.yml up -d --build postgres
docker compose --env-file .env.oracle -f docker-compose.oracle.yml --profile tools run --rm migrate
docker compose --env-file .env.oracle -f docker-compose.oracle.yml up -d --build
```

The first MOS build can take a while because it compiles ViSQOL.

Check status:

```bash
docker compose --env-file .env.oracle -f docker-compose.oracle.yml ps
docker compose --env-file .env.oracle -f docker-compose.oracle.yml logs -f web
```

Then open `NEXT_PUBLIC_APP_URL`.

## 5. Updating later

```bash
git pull
docker compose --env-file .env.oracle -f docker-compose.oracle.yml --profile tools run --rm migrate
docker compose --env-file .env.oracle -f docker-compose.oracle.yml up -d --build
```

## Notes

- Private audio is stored in the Docker `audio_data` volume, not Google Cloud Storage.
- Agent credential encryption uses `LIGHTCURVE_CREDENTIAL_SECRET` unless Google KMS is configured.
- Replay caller speech generation still uses Google Text-to-Speech through `src/lib/gcp.ts`. Oracle hosts the app, database, local audio, and MOS service, but Google TTS credentials are still needed for that specific feature until it is replaced.
- Do not expose Postgres publicly. The Compose file keeps it internal.
- Add backups before real usage. At minimum, back up Postgres and the `audio_data` Docker volume.
