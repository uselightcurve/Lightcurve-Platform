#!/usr/bin/env python
"""Import real-world support utterances into Lightcurve scenario seeds.

The importer intentionally creates review-required seed scenarios instead of
production-ready tests. Public datasets are useful raw material, but a human
should approve domain fit, licensing, and phrasing before a seed becomes part
of a customer's release gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

import requests
from datasets import load_dataset
from huggingface_hub import HfApi


HF_ROWS_URL = "https://datasets-server.huggingface.co/rows"

MASSIVE_CONFIGS = ("en-US", "hi-IN", "es-ES")
MASSIVE_SCENARIOS = {
    "takeaway": "ecommerce",
    "transport": "telecom",
    "qa": "banking",
    "email": "general",
    "calendar": "healthcare",
}

BITEXT_DOMAIN_MAP = {
    "ACCOUNT": "telecom",
    "ORDER": "ecommerce",
    "PAYMENT": "banking",
    "REFUND": "ecommerce",
    "SHIPPING": "ecommerce",
    "DELIVERY": "ecommerce",
    "INVOICE": "banking",
    "SUBSCRIPTION": "telecom",
}

BANKING_INTENT_EMOTION = {
    "cash_withdrawal": "frustrated",
    "cash_withdrawal_card": "frustrated",
    "beneficiary_not_verified": "nervous",
    "card_arrival": "frustrated",
    "card_not_received": "frustrated",
    "cash_withdrawal": "frustrated",
    "cash_withdrawal_card": "frustrated",
    "contactless_not_working": "frustrated",
    "compromised_card": "nervous",
    "cash_withdrawal_pending": "nervous",
    "cash_withdrawal_reverted": "nervous",
}

EMOTION_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("angry", ("angry", "furious", "refund", "complaint", "wrong charge", "never got")),
    ("frustrated", ("again", "waiting", "not working", "outage", "cancel", "still hasn't")),
    ("confused", ("confused", "understand", "help me", "lost", "how do i")),
    ("urgent", ("urgent", "today", "emergency", "immediately", "same day")),
    ("nervous", ("fraud", "suspicious", "stolen", "worried", "compromised")),
)


def slug(value: str, fallback: str = "scenario") -> str:
    safe = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return (safe or fallback)[:56]


def short_hash(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]


def infer_emotion(text: str, intent: str = "") -> str:
    haystack = f"{text} {intent}".lower()
    for emotion, hints in EMOTION_HINTS:
        if any(hint in haystack for hint in hints):
            return emotion
    return "neutral"


def voice_modifiers(language: str, emotion: str) -> dict[str, Any]:
    speed = {
        "angry": 166,
        "frustrated": 154,
        "urgent": 158,
        "nervous": 132,
        "confused": 116,
    }.get(emotion, 140)

    return {
        "noiseDb": 5 if emotion in {"angry", "frustrated"} else 2,
        "speedWpm": speed,
        "interrupts": emotion in {"angry", "frustrated", "urgent"},
        "codeSwitching": language == "hi-IN",
        "accent": language.split("-")[-1],
    }


def scenario_seed(
    *,
    dataset: str,
    license_name: str,
    row_id: str,
    text: str,
    intent: str,
    domain: str,
    language: str,
    emotion: str | None = None,
    confidence: float = 0.72,
) -> dict[str, Any]:
    clean_text = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", lambda match: f"sample {match.group(1).strip().lower()}", text)
    clean_text = re.sub(r"\s+", " ", clean_text).strip()
    clean_intent = slug(intent or clean_text)
    clean_emotion = emotion or infer_emotion(clean_text, clean_intent)
    seed_id = f"seed-hf-{short_hash(dataset + row_id + clean_text)}"

    return {
        "id": seed_id,
        "source": {
            "provider": "huggingface",
            "dataset": dataset,
            "license": license_name or "review-required",
            "rowId": str(row_id),
        },
        "intent": clean_intent,
        "domain": domain,
        "language": language,
        "emotion": clean_emotion,
        "goal": clean_text,
        "openingLine": clean_text,
        "expectedOutcome": (
            f"Agent handles the {clean_intent.replace('_', ' ')} request without "
            "inventing policy, pricing, account, or timeline details."
        ),
        "voiceModifiers": voice_modifiers(language, clean_emotion),
        "confidence": confidence,
        "reviewStatus": "needs-review",
    }


def dataset_license(api: HfApi, dataset: str) -> str:
    try:
        info = api.dataset_info(dataset)
        card_data = getattr(info, "cardData", None)
        if isinstance(card_data, dict):
            value = card_data.get("license")
            if isinstance(value, list):
                return ", ".join(str(item) for item in value)
            if value:
                return str(value)
    except Exception:
        pass
    return "review-required"


def class_names(features: list[dict[str, Any]], name: str) -> list[str]:
    for feature in features:
        if feature.get("name") == name:
            feature_type = feature.get("type")
            if isinstance(feature_type, dict):
                names = feature_type.get("names")
                if isinstance(names, list):
                    return [str(item) for item in names]
    return []


def rows_from_viewer(
    dataset: str,
    config: str,
    split: str,
    offset: int,
    length: int,
    token: str | None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = requests.get(
        HF_ROWS_URL,
        params={
            "dataset": dataset,
            "config": config,
            "split": split,
            "offset": offset,
            "length": length,
        },
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def import_bitext(api: HfApi, limit: int) -> list[dict[str, Any]]:
    dataset = "bitext/Bitext-customer-support-llm-chatbot-training-dataset"
    license_name = dataset_license(api, dataset)
    seeds: list[dict[str, Any]] = []
    seen_intents: set[str] = set()

    stream = load_dataset(dataset, split="train", streaming=True)
    for index, row in enumerate(stream):
        intent = str(row.get("intent") or row.get("category") or "customer_support")
        if intent in seen_intents:
            continue

        text = str(row.get("instruction") or row.get("response") or "")
        if len(text) < 18:
            continue

        category = str(row.get("category") or "").upper()
        seeds.append(
            scenario_seed(
                dataset=dataset,
                license_name=license_name,
                row_id=str(index),
                text=text,
                intent=intent,
                domain=BITEXT_DOMAIN_MAP.get(category, "general"),
                language="en-US",
                confidence=0.78,
            )
        )
        seen_intents.add(intent)
        if len(seeds) >= limit:
            break

    return seeds


def import_banking77(api: HfApi, token: str | None, limit: int) -> list[dict[str, Any]]:
    dataset = "mteb/banking77"
    license_name = dataset_license(api, dataset)
    seeds: list[dict[str, Any]] = []
    seen_intents: set[str] = set()

    for offset in range(0, 1200, 100):
        payload = rows_from_viewer(dataset, "default", "train", offset, 100, token)
        for item in payload.get("rows", []):
            row = item.get("row") or {}
            text = str(row.get("text") or "")
            intent = str(row.get("label_text") or "banking_support")
            if intent in seen_intents or len(text) < 14:
                continue

            seeds.append(
                scenario_seed(
                    dataset=dataset,
                    license_name=license_name,
                    row_id=str(item.get("row_idx")),
                    text=text,
                    intent=intent,
                    domain="banking",
                    language="en-US",
                    emotion=BANKING_INTENT_EMOTION.get(intent),
                    confidence=0.84,
                )
            )
            seen_intents.add(intent)
            if len(seeds) >= limit:
                return seeds

    return seeds


def import_massive(api: HfApi, token: str | None, limit_per_locale: int) -> list[dict[str, Any]]:
    dataset = "AmazonScience/massive"
    license_name = dataset_license(api, dataset)
    seeds: list[dict[str, Any]] = []

    for locale in MASSIVE_CONFIGS:
        payload = rows_from_viewer(dataset, locale, "train", 0, 100, token)
        scenarios = class_names(payload.get("features", []), "scenario")
        intents = class_names(payload.get("features", []), "intent")
        locale_count = 0

        for offset in range(0, 600, 100):
            if offset:
                payload = rows_from_viewer(dataset, locale, "train", offset, 100, token)

            for item in payload.get("rows", []):
                row = item.get("row") or {}
                scenario_index = row.get("scenario")
                intent_index = row.get("intent")
                scenario_name = scenarios[scenario_index] if isinstance(scenario_index, int) and scenario_index < len(scenarios) else ""
                intent_name = intents[intent_index] if isinstance(intent_index, int) and intent_index < len(intents) else "assistant_request"

                if scenario_name not in MASSIVE_SCENARIOS:
                    continue

                text = str(row.get("utt") or "")
                if len(text) < 12:
                    continue

                seeds.append(
                    scenario_seed(
                        dataset=f"{dataset}:{locale}",
                        license_name=license_name,
                        row_id=str(row.get("id") or item.get("row_idx")),
                        text=text,
                        intent=intent_name,
                        domain=MASSIVE_SCENARIOS[scenario_name],
                        language=locale,
                        confidence=0.7,
                    )
                )
                locale_count += 1
                if locale_count >= limit_per_locale:
                    break

            if locale_count >= limit_per_locale:
                break

    return seeds


def dedupe(seeds: list[dict[str, Any]], total_limit: int) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for seed in seeds:
        key = slug(f"{seed['language']} {seed['domain']} {seed['openingLine']}")
        if key in seen:
            continue
        seen.add(key)
        output.append(seed)
        if len(output) >= total_limit:
            break
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Hugging Face scenario seed data for Lightcurve.")
    parser.add_argument("--output", default="src/data/real-scenario-seeds.json")
    parser.add_argument("--limit", type=int, default=72)
    args = parser.parse_args()

    token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    api = HfApi(token=token)

    seeds = []
    seeds.extend(import_bitext(api, limit=24))
    for importer in (
        lambda: import_banking77(api, token=token, limit=18),
        lambda: import_massive(api, token=token, limit_per_locale=12),
    ):
        try:
            seeds.extend(importer())
        except Exception as exc:
            print(f"Skipped one Hugging Face source: {exc}")
    seeds = dedupe(seeds, args.limit)

    if not seeds:
        raise SystemExit("No scenario seeds were imported from Hugging Face.")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(seeds, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    sources = sorted({seed["source"]["dataset"] for seed in seeds})
    print(f"Imported {len(seeds)} scenario seeds into {output}")
    print("Sources:")
    for source in sources:
        print(f"- {source}")


if __name__ == "__main__":
    main()
