from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.contracts import CanonicalChatRequest


def test_canonical_request_uses_camel_case_wire_aliases() -> None:
    request = CanonicalChatRequest.model_validate(
        {
            "context": {
                "messages": [{"content": "Hello", "role": "user"}],
                "sourceIds": [],
                "tokenEstimate": 1,
            },
            "contextSnapshotId": str(uuid4()),
            "maxOutputTokens": 512,
            "modelKey": "fake-default",
            "provider": "fake",
            "runId": str(uuid4()),
        }
    )

    assert request.model_dump(by_alias=True)["maxOutputTokens"] == 512


def test_canonical_request_rejects_unknown_provider() -> None:
    with pytest.raises(ValidationError):
        CanonicalChatRequest.model_validate(
            {
                "context": {
                    "messages": [{"content": "Hello", "role": "user"}],
                    "sourceIds": [],
                    "tokenEstimate": 1,
                },
                "contextSnapshotId": str(uuid4()),
                "maxOutputTokens": 512,
                "modelKey": "unknown-default",
                "provider": "unknown",
                "runId": str(uuid4()),
            }
        )


def test_shared_fixtures_match_python_and_json_schema() -> None:
    import json
    from pathlib import Path

    from jsonschema import Draft202012Validator, FormatChecker

    root = Path(__file__).resolve().parents[3] / "packages/provider-contracts"
    schema = json.loads((root / "schemas/canonical-chat-request.schema.json").read_text())
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    cases = json.loads((root / "fixtures/canonical-requests.json").read_text())
    for case in cases:
        payload = case["request"]
        assert validator.is_valid(payload) == case["valid"], case["name"]
        try:
            request = CanonicalChatRequest.model_validate(payload)
        except ValidationError:
            assert not case["valid"], case["name"]
        else:
            assert case["valid"], case["name"]
            assert request.model_dump(mode="json", by_alias=True, exclude_none=True) == payload


def test_execution_envelope_shared_fixtures() -> None:
    import json
    from pathlib import Path

    from jsonschema import Draft202012Validator, FormatChecker

    from app.contracts import ProviderExecutionPlan

    root = Path(__file__).resolve().parents[3] / "packages/provider-contracts"
    validator = Draft202012Validator(
        json.loads((root / "schemas/provider-execution-plan.schema.json").read_text()),
        format_checker=FormatChecker(),
    )
    for case in json.loads((root / "fixtures/execution-plans.json").read_text()):
        assert validator.is_valid(case["plan"]) == case["valid"], case["name"]
        try:
            plan = ProviderExecutionPlan.model_validate(case["plan"])
        except ValidationError:
            assert not case["valid"], case["name"]
        else:
            assert case["valid"], case["name"]
            assert plan.model_dump(mode="json", by_alias=True, exclude_none=True) == case["plan"]


def test_routing_wire_fixtures_match_json_schema_and_python() -> None:
    import json
    from pathlib import Path

    from jsonschema import Draft202012Validator, FormatChecker

    from app.contracts import RoutingRequest

    root = Path(__file__).resolve().parents[3] / "packages/provider-contracts"
    validator = Draft202012Validator(
        json.loads((root / "schemas/routing-request.schema.json").read_text()),
        format_checker=FormatChecker(),
    )
    for case in json.loads((root / "fixtures/routing-requests.json").read_text()):
        assert validator.is_valid(case["request"]) == case["valid"]
        try:
            RoutingRequest.model_validate(case["request"])
        except ValidationError:
            assert not case["valid"]
        else:
            assert case["valid"]


def test_all_provider_events_match_published_event_contract() -> None:
    import asyncio
    import json
    from pathlib import Path

    from jsonschema import Draft202012Validator, FormatChecker
    from test_multi_provider import execution_plan, settings, wire
    from test_provider_contracts import MockTransport

    from app.execution import execute
    from app.providers.registry import ProviderRegistry

    root = Path(__file__).resolve().parents[3] / "packages/provider-contracts"
    validator = Draft202012Validator(
        json.loads((root / "schemas/provider-event.schema.json").read_text()),
        format_checker=FormatChecker(),
    )

    async def run() -> None:
        for provider in ["openai", "anthropic", "gemini"]:
            config = settings()
            async for event in execute(
                execution_plan(provider),
                ProviderRegistry(config, MockTransport(wire(provider))),
                config,
            ):
                validator.validate(event.model_dump(by_alias=True, mode="json", exclude_none=True))

    asyncio.run(run())
