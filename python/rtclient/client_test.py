# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import os
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Generator
from pathlib import Path
from typing import Optional

import numpy as np
import pytest
import soundfile as sf
from azure.core.credentials import AzureKeyCredential
from azure.identity.aio import DefaultAzureCredential
from dotenv import load_dotenv
from scipy.signal import resample

from rtclient import RealtimeException, RTClient, RTInputAudioItem, RTResponse
from rtclient.models import InputAudioTranscription, InputTextContentPart, NoTurnDetection, ServerVAD, UserMessageItem

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


@pytest.fixture
def audio_files(test_data_dir: str) -> Callable[[str], AsyncIterator[str]]:
    def get_audio_file(file_name: str) -> AsyncIterator[str]:
        samples = AudioSamples(os.path.join(test_data_dir, file_name))
        return samples.chunks()

    return get_audio_file


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
    item = await client.commit_audio()
    await item


@pytest.mark.asyncio
async def test_commit_audio_with_transcription(client: RTClient, audio_samples: Generator[bytes]):
    await client.configure(
        turn_detection=NoTurnDetection(), input_audio_transcription=InputAudioTranscription(model="whisper-1")
    )
    for chunk in audio_samples:
        await client.send_audio(chunk)
    item = await client.commit_audio()
    assert item is not None
    await item
    assert item.transcript is not None
    assert len(item.transcript) > 0


@pytest.mark.asyncio
async def test_clear_audio(client: RTClient, audio_samples: Generator[bytes]):
    await client.configure(turn_detection=NoTurnDetection())
    for chunk in audio_samples:
        await client.send_audio(chunk)
    await client.clear_audio()

    with pytest.raises(RealtimeException) as ex:
        await client.commit_audio()
    assert "buffer" in ex.value.message


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
            async for chunk in part.audio_chunks():
                assert chunk is not None
                audio += chunk
            assert len(audio) > 0
            transcript = ""
            async for chunk in part.transcript_chunks():
                assert chunk is not None
                transcript += chunk
            assert part.transcript == transcript


function_declarations = {
    "get_weather_by_location": {
        "name": "get_weather_by_location",
        "type": "function",
        "description": "A function to get the weather based on a location.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "The name of the city to get the weather for."}},
            "required": ["city"],
        },
    },
}


@pytest.mark.asyncio
async def test_items_text_in_function_call_out_chunks(client: RTClient):
    await client.configure(
        modalities={"text"},
        tools=[function_declarations["get_weather_by_location"]],
        turn_detection=NoTurnDetection(),
    )

    await client.send_item(
        item=UserMessageItem(content=[InputTextContentPart(text="What's the weather like in Seattle, Washington?")])
    )
    response = await client.generate_response()

    item = await anext(response)
    assert item.type == "function_call"
    assert item.function_name == "get_weather_by_location"

    arguments = ""
    async for chunk in item:
        assert chunk is not None
        arguments += chunk
    assert item.arguments == arguments


@pytest.mark.asyncio
async def test_items_text_in_function_call_out_await(client: RTClient):
    await client.configure(
        modalities={"text"},
        tools=[function_declarations["get_weather_by_location"]],
        turn_detection=NoTurnDetection(),
    )

    await client.send_item(
        item=UserMessageItem(content=[InputTextContentPart(text="What's the weather like in Seattle, Washington?")])
    )
    response = await client.generate_response()

    item = await anext(response)
    assert item.type == "function_call"
    assert item.function_name == "get_weather_by_location"

    await item
    assert item.arguments is not None
    assert len(item.arguments) > 0
    arguments = json.loads(item.arguments)
    assert "city" in arguments


@pytest.mark.asyncio
async def test_function_call_fails_await_after_iter(client: RTClient):
    await client.configure(
        modalities={"text"},
        tools=[function_declarations["get_weather_by_location"]],
        turn_detection=NoTurnDetection(),
    )

    await client.send_item(
        item=UserMessageItem(content=[InputTextContentPart(text="What's the weather like in Seattle, Washington?")])
    )
    response = await client.generate_response()
    item = await anext(response)

    async for _ in item:
        pass

    with pytest.raises(RuntimeError) as ex:
        await item

    assert "Cannot await after iterating" in ex.value.args[0]


@pytest.mark.asyncio
async def test_function_call_fails_iter_after_await(client: RTClient):
    await client.configure(
        modalities={"text"},
        tools=[function_declarations["get_weather_by_location"]],
        turn_detection=NoTurnDetection(),
    )

    await client.send_item(
        item=UserMessageItem(content=[InputTextContentPart(text="What's the weather like in Seattle, Washington?")])
    )
    response = await client.generate_response()
    item = await anext(response)

    await item

    with pytest.raises(RuntimeError) as ex:
        async for _ in item:
            pass

    assert "Cannot iterate after awaiting" in ex.value.args[0]


@pytest.mark.asyncio
async def test_items_audio_in_text_out(client: RTClient, audio_files: Callable[[str], Generator[bytes]]):
    audio_file = audio_files("1-tardigrades.wav")
    await client.configure(
        modalities={"text"},
        input_audio_transcription=InputAudioTranscription(model="whisper-1"),
        turn_detection=NoTurnDetection(),
    )
    for chunk in audio_file:
        await client.send_audio(chunk)
    await client.commit_audio()
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
async def test_items_audio_in_text_out_with_vad(client: RTClient, audio_files: Callable[[str], Generator[bytes]]):
    audio_samples = audio_files("1-tardigrades.wav")
    await client.configure(
        modalities={"text"},
        input_audio_transcription=InputAudioTranscription(model="whisper-1"),
        turn_detection=ServerVAD(),
    )
    for chunk in audio_samples:
        await client.send_audio(chunk)
    input_item: Optional[RTInputAudioItem] = None
    response: Optional[RTResponse] = None
    for _ in [1, 2]:
        item = await anext(client.events())
        if item.type == "input_audio":
            input_item = item
        if item.type == "response":
            response = item

    assert input_item is not None
    await input_item
    assert input_item.transcript is not None
    assert len(input_item.transcript) > 0

    assert response is not None
    item = await anext(response)
    assert item.type == "message"
    async for part in item:
        text = ""
        assert part.type == "text"
        async for chunk in part.text_chunks():
            assert chunk is not None
            text += chunk
        assert part.text == text
