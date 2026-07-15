# Admin Credit Grants

Manual credit grants are handled through the internal admin credits endpoint.
This avoids direct database access and keeps an audit record in `billing_events`.

## Configure

Set a long random token in production:

```text
ADMIN_CREDITS_TOKEN=<long-random-secret>
```

The route is protected by `Authorization: Bearer <ADMIN_CREDITS_TOKEN>`.

## Grant Credits

```powershell
$env:LIGHTCURVE_BASE_URL="https://app.uselightcurve.com"
$env:ADMIN_CREDITS_TOKEN="<admin-token>"
npm.cmd run admin:grant-credits -- shivam@kolsetu.com 5000 25000 "Launch credits"
```

The command grants testing minutes and eval actions to the account matching the
email address. It returns the account, grant size, total manual credits, and
remaining minutes/actions.

## Implementation Notes

Credits are stored as negative `usage_events` with `event_type =
manual_credit_grant`. Billing summary code separates positive usage from
negative credits, so the UI shows normal usage while quota checks include the
granted credits.
