from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, Iterable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


JsonDict = Dict[str, Any]


class LightcurveError(Exception):
    """Raised when the Lightcurve API returns a non-success response."""

    def __init__(self, message: str, status: int | None = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.details = details


def _trim_base_url(url: str) -> str:
    return url.rstrip("/")


def _to_camel_case_payload(payload: Mapping[str, Any]) -> JsonDict:
    mapped: JsonDict = {}
    aliases = {
        "agent_type": "agentType",
        "agent_config": "agentConfig",
        "scenario_ids": "scenarioIds",
        "scenario_overrides": "scenarioOverrides",
        "agent_connection_id": "agentConnectionId",
        "git_sha": "gitSha",
        "webrtc_endpoint": "webrtcEndpoint",
        "promoted_from_experiment_id": "promotedFromExperimentId",
    }
    for key, value in payload.items():
        mapped[aliases.get(key, key)] = value
    return mapped


def _scenario_ids_from(
    scenario_ids: Iterable[str] | None = None,
    scenarios: Iterable[str] | None = None,
) -> list[str]:
    return list(scenario_ids if scenario_ids is not None else scenarios or [])


def _is_terminal_experiment(data: Mapping[str, Any]) -> bool:
    status = data.get("status")
    if status in {"completed", "complete", "failed"}:
        return True
    runs = data.get("runs")
    if not isinstance(runs, list) or not runs:
        return False
    return all(isinstance(run, Mapping) and run.get("status") in {"complete", "failed"} for run in runs)


class Lightcurve:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
        extra_headers: Mapping[str, str] | None = None,
    ):
        self.api_key = api_key or os.getenv("LIGHTCURVE_API_KEY") or os.getenv("VS_API_KEY") or ""
        self.base_url = _trim_base_url(base_url or os.getenv("LIGHTCURVE_BASE_URL") or "https://app.uselightcurve.com")
        self.timeout = timeout
        self.extra_headers = dict(extra_headers or {})

    def create_experiment(
        self,
        *,
        name: str,
        agent_type: str,
        agent_config: Mapping[str, Any] | None = None,
        webrtc_endpoint: str | None = None,
        scenario_ids: Iterable[str] | None = None,
        scenarios: Iterable[str] | None = None,
        scenario_overrides: list[Any] | None = None,
        agent_connection_id: str | None = None,
        git_sha: str | None = None,
        promoted_from_experiment_id: str | None = None,
        **extra: Any,
    ) -> JsonDict:
        payload = _to_camel_case_payload(
            {
                "name": name,
                "agent_type": agent_type,
                "agent_config": dict(agent_config or {}),
                "webrtc_endpoint": webrtc_endpoint,
                "scenario_ids": _scenario_ids_from(scenario_ids, scenarios),
                "scenario_overrides": scenario_overrides,
                "agent_connection_id": agent_connection_id,
                "git_sha": git_sha,
                "promoted_from_experiment_id": promoted_from_experiment_id,
                **extra,
            }
        )
        return self._request("POST", "/api/experiments", payload)

    def run_suite(
        self,
        *,
        name: str,
        agent_type: str,
        agent_config: Mapping[str, Any] | None = None,
        webrtc_endpoint: str | None = None,
        scenario_ids: Iterable[str] | None = None,
        scenarios: Iterable[str] | None = None,
        scenario_overrides: list[Any] | None = None,
        agent_connection_id: str | None = None,
        git_sha: str | None = None,
        promoted_from_experiment_id: str | None = None,
        auto_start: bool = True,
        parallel: int = 3,
        timeout_seconds: float = 300.0,
        poll_interval_seconds: float = 5.0,
        **extra: Any,
    ) -> JsonDict:
        created = self.create_experiment(
            name=name,
            agent_type=agent_type,
            agent_config=agent_config,
            webrtc_endpoint=webrtc_endpoint,
            scenario_ids=scenario_ids,
            scenarios=scenarios,
            scenario_overrides=scenario_overrides,
            agent_connection_id=agent_connection_id,
            git_sha=git_sha,
            promoted_from_experiment_id=promoted_from_experiment_id,
            **extra,
        )
        if auto_start:
            runs = created.get("runs") or []
            batch_size = max(1, int(parallel))
            for index in range(0, len(runs), batch_size):
                for run in runs[index:index + batch_size]:
                    if isinstance(run, Mapping) and run.get("id"):
                        self.start_run(str(run["id"]))

        summary = self.wait_for_experiment(
            str(created["experiment"]["id"]),
            timeout_seconds=timeout_seconds,
            poll_interval_seconds=poll_interval_seconds,
        )
        return {**summary, "experiment": created["experiment"]}

    def run(self, **kwargs: Any) -> JsonDict:
        return self.run_suite(**kwargs)

    def create_lightcurve_room_test(
        self,
        *,
        name: str,
        scenario_ids: Iterable[str] | None = None,
        scenarios: Iterable[str] | None = None,
        scenario_overrides: list[Any] | None = None,
        agent_config: Mapping[str, Any] | None = None,
        git_sha: str | None = None,
    ) -> JsonDict:
        config = {
            "mode": "lightcurve_hosted_room",
            "costMode": "low_cost_testing",
            **dict(agent_config or {}),
        }
        created = self.create_experiment(
            name=name,
            agent_type="livekit",
            agent_config=config,
            webrtc_endpoint="lightcurve-room",
            scenario_ids=scenario_ids,
            scenarios=scenarios,
            scenario_overrides=scenario_overrides,
            git_sha=git_sha,
        )
        runs = created.get("runs") or []
        if not runs:
            raise LightcurveError("No run was created for this Lightcurve room test.", 422, created)
        first_run = runs[0]
        room = self.get_lightcurve_room(str(first_run["id"]))
        return {**created, "firstRun": first_run, "room": room}

    def start_run(self, run_id: str) -> JsonDict:
        return self._request("POST", f"/api/runs/{run_id}/start")

    def get_run(self, run_id: str) -> JsonDict:
        return self._request("GET", f"/api/runs/{run_id}")

    def get_lightcurve_room(self, run_id: str) -> JsonDict:
        return self._request("GET", f"/api/runs/{run_id}/livekit-session")

    def get_experiment(self, experiment_id: str) -> JsonDict:
        return self._request("GET", f"/api/sdk/experiments/{experiment_id}")

    def wait_for_experiment(
        self,
        experiment_id: str,
        *,
        timeout_seconds: float = 300.0,
        poll_interval_seconds: float = 5.0,
    ) -> JsonDict:
        started_at = time.monotonic()
        while time.monotonic() - started_at < timeout_seconds:
            data = self.get_experiment(experiment_id)
            if _is_terminal_experiment(data):
                return data
            time.sleep(poll_interval_seconds)
        raise LightcurveError(f"Timed out waiting for experiment {experiment_id}.", 408)

    def list_scenarios(self, **params: Any) -> JsonDict:
        query = urlencode({key: value for key, value in params.items() if value is not None})
        suffix = f"?{query}" if query else ""
        return self._request("GET", f"/api/scenarios{suffix}")

    def fork_scenario(self, parent_id: str, *, name: str, patch: list[Any]) -> JsonDict:
        return self._request("POST", f"/api/scenarios/{parent_id}/fork", {"name": name, "patch": patch})

    def compare_experiments(self, experiment_id: str, compare_id: str) -> JsonDict:
        query = urlencode({"compareId": compare_id})
        return self._request("POST", f"/api/experiments/{experiment_id}/compare?{query}")

    def list_agent_connections(self) -> JsonDict:
        return self._request("GET", "/api/agent-connections")

    def create_agent_connection(self, payload: Mapping[str, Any]) -> JsonDict:
        return self._request("POST", "/api/agent-connections", dict(payload))

    def test_agent_connection(self, connection_id: str) -> JsonDict:
        return self._request("POST", f"/api/agent-connections/{connection_id}/test")

    def _request(self, method: str, path: str, payload: Mapping[str, Any] | None = None) -> JsonDict:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Accept": "application/json",
            "X-Lightcurve-SDK": "python/0.3.0",
            **self.extra_headers,
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        request = Request(f"{self.base_url}{path}", data=body, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return self._decode_response(response.status, response.headers.get("content-type"), response.read())
        except HTTPError as error:
            details = self._decode_error(error)
            message = details.get("error") if isinstance(details, dict) else None
            raise LightcurveError(message or f"Lightcurve request failed with status {error.code}.", error.code, details) from error
        except URLError as error:
            raise LightcurveError(f"Could not reach Lightcurve API: {error.reason}") from error

    @staticmethod
    def _decode_response(status: int, content_type: str | None, raw: bytes) -> JsonDict:
        text = raw.decode("utf-8") if raw else ""
        if content_type and "application/json" in content_type:
            parsed = json.loads(text) if text else {}
            if isinstance(parsed, dict):
                return parsed
            return {"data": parsed}
        return {"status": status, "body": text}

    @staticmethod
    def _decode_error(error: HTTPError) -> Any:
        raw = error.read()
        text = raw.decode("utf-8") if raw else ""
        content_type = error.headers.get("content-type")
        if content_type and "application/json" in content_type and text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"error": text}
        return {"error": text or f"HTTP {error.code}"}


class VoiceSandbox(Lightcurve):
    pass


def create_client(**config: Any) -> Lightcurve:
    return Lightcurve(**config)
