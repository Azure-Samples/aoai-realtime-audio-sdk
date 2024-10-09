# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.


from collections.abc import AsyncGenerator
import os
from dotenv import load_dotenv
import pytest
from azure.identity.aio import DefaultAzureCredential

from rtclient import RTClient

load_dotenv()

run_live_tests = os.getenv("LIVE_TESTS") == "true"

azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
azure_openai_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")

if not run_live_tests:
    pytest.skip("Skipping live tests")


@pytest.fixture
async def azure_openai_client() -> AsyncGenerator[RTClient, None]:
    async with (
        DefaultAzureCredential() as credential,
        RTClient(
            url=azure_openai_endpoint, azure_deployment=azure_openai_deployment, token_credential=credential
        ) as client,
    ):
        yield client


@pytest.mark.asyncio
async def test_configure(azure_openai_client: RTClient):
    original_session = azure_openai_client.session
    assert original_session is not None
    updated_session = await azure_openai_client.configure(instructions="You are a helpful assistant.")
    assert updated_session is not None


@pytest.mark.asyncio
async def test_commit_audio(azure_openai_client: RTClient):
    original_session = azure_openai_client.session
    assert original_session is not None
    await azure_openai_client.commit_audio()
    updated_session = azure_openai_client.session
    assert updated_session is not None