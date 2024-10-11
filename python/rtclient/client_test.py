# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.


import os
from collections.abc import AsyncGenerator, AsyncIterator, Generator
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from azure.core.credentials import AzureKeyCredential
from azure.identity.aio import DefaultAzureCredential
from dotenv import load_dotenv
from scipy.signal import resample

from rtclient import RealtimeException, RTClient
from rtclient.models import InputTextContentPart, NoTurnDetection, UserMessageItem

load_dotenv()

run_live_tests = os.getenv("LIVE_TESTS") == "true"

openai_key = os.getenv("OPENAI_API_KEY")
openai_model = os.getenv("OPENAI_MODEL")

azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
azure_openai_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")


def should_run_openai_live_tests():
    return run_live_tests and openai_key is not None and openai_model is not None


def should_run_azure_openai_live_tests():
    return run_live_tests and azure_openai_endpoint is not None and azure_openai_deployment is not None


if not run_live_tests:
    pytest.skip("Skipping live tests")


@pytest.fixture
def test_data_dir() -> str:
    return os.path.join(Path(__file__).parent.parent, "test_data")


def resample_audio(audio_data, original_sample_rate, target_sample_rate):
    number_of_samples = round(len(audio_data) * float(target_sample_rate) / original_sample_rate)
    resampled_audio = resample(audio_data, number_of_samples)
    return resampled_audio.astype(np.int16)


class AudioSamples:
    def __init__(self, audio_file: str, sample_rate: int = 24000):
        self._sample_rate = sample_rate
        audio_data, original_sample_rate = sf.read(audio_file, dtype="int16")

        if original_sample_rate != sample_rate:
            audio_data = resample_audio(audio_data, original_sample_rate, sample_rate)
        self._audio_bytes = audio_data.tobytes()

    def chunks(self):
        duration_ms = 100
        samples_per_chunk = self._sample_rate * (duration_ms / 1000)
        bytes_per_sample = 2
        bytes_per_chunk = int(samples_per_chunk * bytes_per_sample)
        for i in range(0, len(self._audio_bytes), bytes_per_chunk):
            yield self._audio_bytes[i : i + bytes_per_chunk]


@pytest.fixture
def audio_samples(test_data_dir: str) -> AsyncIterator[bytes]:
    samples = AudioSamples(os.path.join(test_data_dir, "1-tardigrades.wav"))
    return samples.chunks()


@pytest.fixture(params=["openai", "azure_openai"])
async def client(request: pytest.FixtureRequest) -> AsyncGenerator[RTClient, None]:
    if request.param == "openai" and should_run_openai_live_tests():
        async with (
            RTClient(
                key_credential=AzureKeyCredential(openai_key),
                model=openai_model,
            ) as client,
        ):
            yield client
    elif request.param == "azure_openai" and should_run_azure_openai_live_tests():
        async with (
            DefaultAzureCredential() as credential,
            RTClient(
                url=azure_openai_endpoint, azure_deployment=azure_openai_deployment, token_credential=credential
            ) as client,
        ):
            yield client
    else:
        pytest.skip(f"Skipping {request.param} live tests")


@pytest.mark.asyncio
async def test_configure(client: RTClient):
    original_session = client.session
    assert original_session is not None
    updated_session = await client.configure(instructions="You are a helpful assistant.")
    assert updated_session is not None


@pytest.mark.asyncio
async def test_commit_audio(client: RTClient, audio_samples: Generator[bytes]):
    await client.configure(turn_detection=NoTurnDetection())
    for chunk in audio_samples:
        await client.send_audio(chunk)
    item_id = await client.commit_audio()
    assert item_id is not None


@pytest.mark.asyncio
async def test_clear_audio(client: RTClient, audio_samples: Generator[bytes]):
    await client.configure(turn_detection=NoTurnDetection())
    for chunk in audio_samples:
        await client.send_audio(chunk)
    await client.clear_audio()

    with pytest.raises(RealtimeException) as ex:
        await client.commit_audio()
    assert "buffer is empty" in ex.value.message


@pytest.mark.asyncio
async def test_send_item(client: RTClient):
    item = await client.send_item(
        item=UserMessageItem(content=[InputTextContentPart(text="This is my first message!")])
    )
    assert item is not None


@pytest.mark.asyncio
async def test_remove_item(client: RTClient):
    item = await client.send_item(
        item=UserMessageItem(content=[InputTextContentPart(text="This is my first message!")])
    )
    assert item is not None
    await client.remove_item(item_id=item.id)

    with pytest.raises(RealtimeException) as ex:
        await client.send_item(
            item=UserMessageItem(content=[InputTextContentPart(text="This is my second message!")]),
            previous_item_id=item.id,
        )
    assert item.id in ex.value.message
    assert "does not exist" in ex.value.message


@pytest.mark.asyncio
async def test_generate_response(client: RTClient):
    await client.configure(modalities={"text"}, turn_detection=NoTurnDetection())
    item = await client.send_item(
        item=UserMessageItem(
            content=[InputTextContentPart(text="Repeat exactly the following sentence: Hello, world!")]
        )
    )
    response = await client.generate_response()
    assert response is not None
    assert response.id is not None
    response_item = await anext(response)
    assert response_item is not None
    assert response_item.response_id == response.id
    assert response_item.previous_id == item.id


@pytest.mark.asyncio
async def test_cancel_response(client: RTClient):
    await client.configure(modalities={"text"}, turn_detection=NoTurnDetection())
    await client.send_item(
        item=UserMessageItem(
            content=[InputTextContentPart(text="Repeat exactly the following sentence: Hello, world!")]
        )
    )
    response = await client.generate_response()
    await response.cancel()

    with pytest.raises(StopAsyncIteration):
        await anext(response)

    assert response.status in ["cancelled", "completed"]


@pytest.mark.asyncio
async def test_items_text_in_text_out(client: RTClient):
    await client.configure(modalities={"text"}, turn_detection=NoTurnDetection())
    await client.send_item(
        item=UserMessageItem(
            content=[InputTextContentPart(text="Repeat exactly the following sentence: Hello, world!")]
        )
    )
    response = await client.generate_response()

    item = await anext(response)
    assert item.type == "message"
    async for part in item:
        text = ""
        assert part.type == "text"
        async for chunk in part.text_chunks():
            assert chunk is not None
            text += chunk
        assert part.text == text


@pytest.mark.asyncio
async def test_items_text_in_audio_out(client: RTClient):
    await client.configure(modalities={"audio", "text"}, turn_detection=NoTurnDetection())
    await client.send_item(
        item=UserMessageItem(
            content=[InputTextContentPart(text="Repeat exactly the following sentence: Hello, world!")]
        )
    )
    response = await client.generate_response()

    item = await anext(response)
    assert item.type == "message"
    async for part in item:
        if part.type == "audio":
            audio = b""
            print("audio start")
            async for chunk in part.audio_chunks():
                assert chunk is not None
                audio += chunk
            assert len(audio) > 0
            print("audio end")
            print("transcript start")
            transcript = ""
            async for chunk in part.transcript_chunks():
                assert chunk is not None
                print(f"transcript chunk: {chunk}")
                transcript += chunk
            assert part.transcript == transcript
            print("transcript end")
