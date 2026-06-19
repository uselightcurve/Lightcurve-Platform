# Lightcurve Python SDK

Python client for running Lightcurve voice-agent sandbox tests from CI,
notebooks, or backend automation.

Install:

```bash
pip install use-lightcurve
```

Basic usage:

```python
from lightcurve import Lightcurve, providers

lc = Lightcurve(
    base_url="https://app.uselightcurve.com",
    api_key="lc_..."  # or LIGHTCURVE_API_KEY
)

result = lc.run_suite(
    name="booking-agent-release-gate",
    scenario_ids=["email-capture-001", "booking-reschedule-1570"],
    **providers.agent_replica(
        instructions="Confirm dates, guest count, room choice, and final price before booking."
    ),
)

print(result["mos"], result["taskCompletion"])
```

Create a Lightcurve room test:

```python
room_test = lc.create_lightcurve_room_test(
    name="one-off-room-check",
    scenario_ids=["email-capture-001"],
)

print(room_test["room"]["roomName"])
print(room_test["room"]["liveKitUrl"])
print(room_test["room"]["agentToken"])
```

Phone-realism check through a customer-owned Vapi account:

```python
result = lc.run_suite(
    name="failed-cases-phone-check",
    scenario_ids=["refund-angry-001"],
    **providers.phone_realism_vapi(
        agent_phone_number="+14155550123",
        outbound_caller_number_id="vapi-phone-number-uuid",
        api_key="customer-vapi-api-key",
    ),
)
```

Environment variables:

- `LIGHTCURVE_API_KEY`: server-side Lightcurve API key.
- `LIGHTCURVE_BASE_URL`: defaults to `https://app.uselightcurve.com`.

This package is intentionally small and uses only Python's standard library.
