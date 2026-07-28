from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


JsonDict = Dict[str, Any]


class LightcurveError(Exception):
    def __init__(self, message: str, status: int | None = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.details = details


class Lightcurve:
    def __init__(self, *, api_key: str | None = None, base_url: str | None = None, timeout: float = 30.0):
        self.api_key = api_key or os.getenv("LIGHTCURVE_API_KEY") or ""
        self.base_url = (base_url or os.getenv("LIGHTCURVE_BASE_URL") or "https://app.uselightcurve.com").rstrip("/")
        self.timeout = timeout

    def list_datasets(self) -> JsonDict:
        return self._request("GET", "/api/datasets")

    def get_dataset(self, dataset_id: str) -> JsonDict:
        return self._request("GET", f"/api/datasets/{dataset_id}")

    def run_dataset(
        self,
        *,
        dataset_id: str,
        name: str | None = None,
        runtime_id: str | None = None,
        git_sha: str | None = None,
        preset: str = "release",
        replay_count: int | None = None,
        max_concurrency: int | None = None,
        seed: int | None = None,
        judge_policy: str = "flash-pro-review",
        environment_mix: Mapping[str, float] | None = None,
    ) -> JsonDict:
        return self._request("POST", "/api/sdk/run", {
            "datasetId": dataset_id,
            "name": name,
            "runtimeId": runtime_id,
            "gitSha": git_sha,
            "preset": preset,
            "replayCount": replay_count,
            "maxConcurrency": max_concurrency,
            "seed": seed,
            "judgePolicy": judge_policy,
            "environmentMix": dict(environment_mix or {}),
        })

    def get_dataset_run(self, experiment_id: str) -> JsonDict:
        return self._request("GET", f"/api/sdk/experiments/{experiment_id}")

    def wait_for_dataset_run(
        self,
        experiment_id: str,
        *,
        timeout_seconds: float = 600.0,
        poll_interval_seconds: float = 5.0,
    ) -> JsonDict:
        started = time.monotonic()
        while time.monotonic() - started < timeout_seconds:
            result = self.get_dataset_run(experiment_id)
            if result.get("status") in {"complete", "completed", "failed"}:
                return result
            time.sleep(poll_interval_seconds)
        raise LightcurveError(f"Timed out waiting for dataset run {experiment_id}.", 408)

    def _request(self, method: str, path: str, payload: Mapping[str, Any] | None = None) -> JsonDict:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Accept": "application/json", "X-Lightcurve-SDK": "python/0.5.2"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = Request(f"{self.base_url}{path}", data=body, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as error:
            raw = error.read().decode("utf-8")
            try:
                details = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                details = {"error": raw}
            raise LightcurveError(details.get("error", f"HTTP {error.code}"), error.code, details) from error
        except URLError as error:
            raise LightcurveError(f"Could not reach Lightcurve: {error.reason}") from error


VoiceSandbox = Lightcurve


def create_client(**config: Any) -> Lightcurve:
    return Lightcurve(**config)
