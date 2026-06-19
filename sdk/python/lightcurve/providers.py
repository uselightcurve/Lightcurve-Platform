from __future__ import annotations

from typing import Any, Dict


JsonDict = Dict[str, Any]


def agent_replica(
    *,
    instructions: str,
    knowledge: str | None = None,
    tools: JsonDict | None = None,
    confirmation_rules: str | None = None,
    escalation_policy: str | None = None,
    **extra: Any,
) -> JsonDict:
    """Low-cost prompt and policy coverage before provider-backed checks."""
    config: JsonDict = {
        "mode": "agent_replica",
        "costMode": "low_cost_testing",
        "instructions": instructions,
    }
    if knowledge is not None:
        config["knowledge"] = knowledge
    if tools is not None:
        config["tools"] = tools
    if confirmation_rules is not None:
        config["confirmationRules"] = confirmation_rules
    if escalation_policy is not None:
        config["escalationPolicy"] = escalation_policy
    config.update(extra)
    return {
        "agent_type": "agent_replica",
        "agent_config": config,
        "webrtc_endpoint": "agent-replica",
    }


def lightcurve_room(**config: Any) -> JsonDict:
    """Create a Lightcurve test room where the customer agent joins as participant."""
    return {
        "agent_type": "livekit",
        "agent_config": {
            "mode": "lightcurve_hosted_room",
            "costMode": "low_cost_testing",
            **config,
        },
        "webrtc_endpoint": "lightcurve-room",
    }


def advanced_runner(endpoint: str, **config: Any) -> JsonDict:
    """Use a customer-hosted HTTPS runner endpoint for provider-backed tests."""
    return {
        "agent_type": "custom",
        "agent_config": {
            "mode": "advanced_runner",
            "costMode": "provider_backed",
            "endpoint": endpoint,
            **config,
        },
        "webrtc_endpoint": endpoint,
    }


def phone_realism_vapi(
    *,
    agent_phone_number: str,
    outbound_caller_number_id: str,
    api_key: str | None = None,
    api_base: str | None = None,
    **extra: Any,
) -> JsonDict:
    """Run a smaller phone-realism check through a customer-owned Vapi account."""
    config: JsonDict = {
        "mode": "vapi_bot_to_bot_phone",
        "costMode": "phone_realism",
        "targetAgentNumber": agent_phone_number,
        "phoneNumberId": outbound_caller_number_id,
        **extra,
    }
    if api_key:
        config["apiKey"] = api_key
    if api_base:
        config["apiBase"] = api_base
    return {
        "agent_type": "vapi",
        "agent_config": config,
        "webrtc_endpoint": agent_phone_number,
    }
