#!/usr/bin/env python
"""Import real-world support utterances into Lightcurve scenario seeds.

The importer intentionally creates review-required seed scenarios instead of
production-ready tests. Public datasets are useful raw material, but a human
should approve domain fit, licensing, and phrasing before a seed becomes part
of a customer's release gate.
"""

from __future__ import annotations

import argparse
import copy
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

MEDICAL_LEVEL_EMOTION = {
    "Emergency": "urgent",
    "Soon": "nervous",
    "Routine": "neutral",
    "Low": "confused",
}

ECOMMERCE_URGENCY_EMOTION = {
    "Immediate": "urgent",
    "High": "angry",
    "Medium": "frustrated",
    "Low": "confused",
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
    clean_text = text.replace("\ufffd", "'")
    clean_text = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", lambda match: f"sample {match.group(1).strip().lower()}", clean_text)
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
    seen_text: set[str] = set()

    stream = load_dataset(dataset, split="train", streaming=True)
    for index, row in enumerate(stream):
        intent = str(row.get("intent") or row.get("category") or "customer_support")
        text = str(row.get("instruction") or row.get("response") or "")
        text_key = slug(text)
        if len(text) < 18 or text_key in seen_text:
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
        seen_text.add(text_key)
        if len(seeds) >= limit:
            break

    return seeds


def import_banking77(api: HfApi, token: str | None, limit: int) -> list[dict[str, Any]]:
    dataset = "mteb/banking77"
    license_name = dataset_license(api, dataset)
    seeds: list[dict[str, Any]] = []
    seen_intents: set[str] = set()
    seen_text: set[str] = set()

    stream = load_dataset(dataset, split="train", streaming=True)
    for index, row in enumerate(stream):
        text = str(row.get("text") or "")
        intent = str(row.get("label_text") or "banking_support")
        text_key = slug(text)
        if len(text) < 14 or text_key in seen_text:
            continue

        seeds.append(
            scenario_seed(
                dataset=dataset,
                license_name=license_name,
                row_id=str(index),
                text=text,
                intent=intent,
                domain="banking",
                language="en-US",
                emotion=BANKING_INTENT_EMOTION.get(intent),
                confidence=0.84 if intent not in seen_intents else 0.76,
            )
        )
        seen_intents.add(intent)
        seen_text.add(text_key)
        if len(seeds) >= limit:
            break

    return seeds


def import_medical_support(api: HfApi, limit: int) -> list[dict[str, Any]]:
    dataset = "Ataur77/medical-custmer-support"
    license_name = dataset_license(api, dataset)
    seeds: list[dict[str, Any]] = []
    seen_text: set[str] = set()

    stream = load_dataset(dataset, split="train", streaming=True)
    for index, row in enumerate(stream):
        text = str(row.get("customer_query") or "")
        intent = str(row.get("intent") or row.get("department") or "medical_support")
        level = str(row.get("level") or "")
        text_key = slug(text)
        if len(text) < 14 or text_key in seen_text:
            continue

        seeds.append(
            scenario_seed(
                dataset=dataset,
                license_name=license_name,
                row_id=str(index),
                text=text,
                intent=intent,
                domain="healthcare",
                language="en-US",
                emotion=MEDICAL_LEVEL_EMOTION.get(level),
                confidence=0.74,
            )
        )
        seen_text.add(text_key)
        if len(seeds) >= limit:
            break

    return seeds


def import_ecommerce_complaints(api: HfApi, limit: int) -> list[dict[str, Any]]:
    dataset = "Ataur77/ecommerce-customer-support"
    license_name = dataset_license(api, dataset)
    seeds: list[dict[str, Any]] = []
    seen_text: set[str] = set()

    stream = load_dataset(dataset, split="train", streaming=True)
    for index, row in enumerate(stream):
        text = str(row.get("Complaint") or "")
        intent = str(row.get("Category") or "ecommerce_support")
        urgency = str(row.get("Urgency") or "")
        text_key = slug(text)
        if len(text) < 14 or text_key in seen_text:
            continue

        seeds.append(
            scenario_seed(
                dataset=dataset,
                license_name=license_name,
                row_id=str(index),
                text=text,
                intent=intent,
                domain="ecommerce",
                language="en-US",
                emotion=ECOMMERCE_URGENCY_EMOTION.get(urgency),
                confidence=0.73,
            )
        )
        seen_text.add(text_key)
        if len(seeds) >= limit:
            break

    return seeds


def import_telecom_mtn(api: HfApi, limit: int) -> list[dict[str, Any]]:
    dataset = "francis-ogbuagu/MTN_QnA_dataset"
    license_name = dataset_license(api, dataset)
    seeds: list[dict[str, Any]] = []
    seen_text: set[str] = set()

    stream = load_dataset(dataset, split="train", streaming=True)
    for index, row in enumerate(stream):
        text = str(row.get("input") or "")
        answer = str(row.get("response") or "")
        text_key = slug(text)
        if len(text) < 14 or text_key in seen_text:
            continue

        seed = scenario_seed(
            dataset=dataset,
            license_name=license_name,
            row_id=str(index),
            text=text,
            intent="telecom_plan_support",
            domain="telecom",
            language="en-US",
            confidence=0.7,
        )
        if answer:
            seed["expectedOutcome"] = (
                "Agent answers the telecom support question accurately, keeps plan details grounded, "
                "and does not invent unavailable pricing. Reference answer: "
                f"{answer[:220]}"
            )
        seeds.append(seed)
        seen_text.add(text_key)
        if len(seeds) >= limit:
            break

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


VARIANT_PROFILES: tuple[dict[str, Any], ...] = (
    {
        "suffix": "noisy_background",
        "emotion": None,
        "prefix": "There is background noise where I am calling from. ",
        "noiseDb": 8,
        "interrupts": True,
        "speedWpmDelta": 4,
    },
    {
        "suffix": "impatient_interrupting",
        "emotion": "frustrated",
        "prefix": "I am in a hurry and may interrupt if this takes too long. ",
        "noiseDb": 5,
        "interrupts": True,
        "speedWpmDelta": 18,
    },
    {
        "suffix": "confused_repeat",
        "emotion": "confused",
        "prefix": "I am confused and may repeat myself. ",
        "noiseDb": 2,
        "interrupts": False,
        "speedWpmDelta": -14,
    },
    {
        "suffix": "urgent_resolution",
        "emotion": "urgent",
        "prefix": "I need this handled today. ",
        "noiseDb": 3,
        "interrupts": True,
        "speedWpmDelta": 10,
    },
    {
        "suffix": "low_confidence_stt",
        "emotion": "nervous",
        "prefix": "My phone signal is weak, so please confirm details carefully. ",
        "noiseDb": 9,
        "interrupts": False,
        "speedWpmDelta": -6,
    },
    {
        "suffix": "elderly_slow_speech",
        "emotion": "confused",
        "prefix": "Please go slowly, I may need you to repeat the next step. ",
        "noiseDb": 1,
        "interrupts": False,
        "speedWpmDelta": -28,
    },
)


def make_variant(seed: dict[str, Any], profile: dict[str, Any], index: int) -> dict[str, Any]:
    variant = copy.deepcopy(seed)
    profile_suffix = str(profile["suffix"])
    variant["id"] = f"{seed['id']}-{profile_suffix}-{index}"
    variant["intent"] = f"{seed['intent']}_{profile_suffix}"[:56]
    variant["goal"] = f"{profile['prefix']}{seed['goal']}"
    variant["openingLine"] = f"{profile['prefix']}{seed['openingLine']}"
    variant["emotion"] = profile["emotion"] or seed["emotion"]
    variant["confidence"] = min(float(seed["confidence"]), 0.68)
    variant["source"] = {
        **seed["source"],
        "rowId": f"{seed['source'].get('rowId', seed['id'])}:{profile_suffix}",
    }
    modifiers = variant["voiceModifiers"]
    modifiers["noiseDb"] = int(profile["noiseDb"])
    modifiers["interrupts"] = bool(profile["interrupts"])
    modifiers["speedWpm"] = max(92, min(184, int(modifiers.get("speedWpm", 140)) + int(profile["speedWpmDelta"])))
    variant["expectedOutcome"] = (
        f"{seed['expectedOutcome']} Judge whether the agent still succeeds under the "
        f"{profile_suffix.replace('_', ' ')} condition."
    )
    return variant


def expand_to_target(seeds: list[dict[str, Any]], total_limit: int) -> list[dict[str, Any]]:
    expanded = list(seeds)
    if len(expanded) >= total_limit:
        return expanded[:total_limit]

    for index, seed in enumerate(seeds):
        for profile in VARIANT_PROFILES:
            expanded.append(make_variant(seed, profile, index))
            if len(expanded) >= total_limit:
                return dedupe(expanded, total_limit)

    return dedupe(expanded, total_limit)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Hugging Face scenario seed data for Lightcurve.")
    parser.add_argument("--output", default="src/data/real-scenario-seeds.json")
    parser.add_argument("--limit", type=int, default=3000)
    args = parser.parse_args()

    token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    api = HfApi(token=token)

    seeds = []
    seeds.extend(import_bitext(api, limit=900))
    for importer in (
        lambda: import_banking77(api, token=token, limit=700),
        lambda: import_medical_support(api, limit=650),
        lambda: import_telecom_mtn(api, limit=450),
        lambda: import_ecommerce_complaints(api, limit=350),
        lambda: import_massive(api, token=token, limit_per_locale=35),
    ):
        try:
            seeds.extend(importer())
        except Exception as exc:
            print(f"Skipped one Hugging Face source: {exc}")
    existing_path = Path(args.output)
    if existing_path.exists():
        try:
            previous = json.loads(existing_path.read_text(encoding="utf-8"))
            if isinstance(previous, list):
                seeds.extend(previous)
        except Exception:
            pass
    seeds = dedupe(seeds, args.limit)
    seeds = expand_to_target(seeds, args.limit)

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
