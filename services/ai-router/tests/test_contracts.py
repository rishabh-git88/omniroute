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
