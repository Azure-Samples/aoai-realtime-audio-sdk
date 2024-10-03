# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import base64
import os
import sys

import numpy as np
import soundfile as sf
from azure.core.credentials import AzureKeyCredential
from dotenv import load_dotenv
from scipy.signal import resample

from rtclient import InputAudioTranscription, RTClient, RTInputItem, RTOutputItem, RTResponse, ServerVAD


def resample_audio(audio_data, original_sample_rate, target_sample_rate):
    number_of_samples = round(len(audio_data) * float(target_sample_rate) / original_sample_rate)
    resampled_audio = resample(audio_data, number_of_samples)
    return resampled_audio.astype(np.int16)


async def send_audio(client: RTClient, audio_file_path: str):
    sample_rate = 24000
    duration_ms = 100
    samples_per_chunk = sample_rate * (duration_ms / 1000)
    bytes_per_sample = 2
    bytes_per_chunk = int(samples_per_chunk * bytes_per_sample)

    extra_params = (
        {
            "samplerate": sample_rate,
            "channels": 1,
            "subtype": "PCM_16",
        }
        if audio_file_path.endswith(".raw")
        else {}
    )

    audio_data, original_sample_rate = sf.read(audio_file_path, dtype="int16", **extra_params)

    if original_sample_rate != sample_rate:
        audio_data = resample_audio(audio_data, original_sample_rate, sample_rate)

    audio_bytes = audio_data.tobytes()

    for i in range(0, len(audio_bytes), bytes_per_chunk):
        chunk = audio_bytes[i : i + bytes_per_chunk]
        await client.send_audio(chunk)


async def receive_control(client: RTClient):
    async for control in client.control_messages():
        if control is not None:
            print(f"Received a control message: {control.type}")
        else:
            break


async def receive_item(item: RTOutputItem, out_dir: str):
    prefix = f"[response={item.response_id}][item={item.id}]"
    audio_data = None
    audio_transcript = None
    text_data = None
    arguments = None
    async for chunk in item:
        if chunk.type == "audio_transcript":
            audio_transcript = (audio_transcript or "") + chunk.data
        elif chunk.type == "audio":
            if audio_data is None:
                audio_data = bytearray()
            audio_bytes = base64.b64decode(chunk.data)
            audio_data.extend(audio_bytes)
        elif chunk.type == "tool_call_arguments":
            arguments = (arguments or "") + chunk.data
        elif chunk.type == "text":
            text_data = (text_data or "") + chunk.data
    if text_data is not None:
        print(prefix, f"Text: {text_data}")
        with open(os.path.join(out_dir, f"{item.id}.text.txt"), "w", encoding="utf-8") as out:
            out.write(text_data)
    if audio_data is not None:
        print(prefix, f"Audio received with length: {len(audio_data)}")
        with open(os.path.join(out_dir, f"{item.id}.wav"), "wb") as out:
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            sf.write(out, audio_array, samplerate=24000)
    if audio_transcript is not None:
        print(prefix, f"Audio Transcript: {audio_transcript}")
        with open(os.path.join(out_dir, f"{item.id}.audio_transcript.txt"), "w", encoding="utf-8") as out:
            out.write(audio_transcript)
    if arguments is not None:
        print(prefix, f"Tool Call Arguments: {arguments}")
        with open(os.path.join(out_dir, f"{item.id}.tool.streamed.json"), "w", encoding="utf-8") as out:
            out.write(arguments)


async def receive_response(client: RTClient, response: RTResponse, out_dir: str):
    prefix = f"[response={response.id}]"
    async for item in response:
        print(prefix, f"Received item {item.id}")
        asyncio.create_task(receive_item(item, out_dir))
    print(prefix, "Response completed")
    await client.close()


async def receive_input_item(item: RTInputItem):
    prefix = f"[input_item={item.id}]"
    await item
    print(prefix, f"Previous Id: {item.previous_id}")
    print(prefix, f"Transcript: {item.transcript}")
    print(prefix, f"Audio Start [ms]: {item.audio_start_ms}")
    print(prefix, f"Audio End [ms]: {item.audio_end_ms}")


async def receive_items(client: RTClient, out_dir: str):
    async for item in client.items():
        if isinstance(item, RTResponse):
            asyncio.create_task(receive_response(client, item, out_dir))
        else:
            asyncio.create_task(receive_input_item(item))


async def receive_messages(client: RTClient, out_dir: str):
    await asyncio.gather(
        receive_items(client, out_dir),
        receive_control(client),
    )


async def run(client: RTClient, audio_file_path: str, out_dir: str):
    print("Configuring Session...", end="", flush=True)
    await client.configure(
        turn_detection=ServerVAD(), input_audio_transcription=InputAudioTranscription(model="whisper-1")
    )
    print("Done")

    await asyncio.gather(send_audio(client, audio_file_path), receive_messages(client, out_dir))


def get_env_var(var_name: str) -> str:
    value = os.environ.get(var_name)
    if not value:
        raise OSError(f"Environment variable '{var_name}' is not set or is empty.")
    return value


async def with_azure_openai(audio_file_path: str, out_dir: str):
    endpoint = get_env_var("AZURE_OPENAI_ENDPOINT")
    key = get_env_var("AZURE_OPENAI_API_KEY")
    deployment = get_env_var("AZURE_OPENAI_DEPLOYMENT")
    async with RTClient(url=endpoint, key_credential=AzureKeyCredential(key), azure_deployment=deployment) as client:
        await run(client, audio_file_path, out_dir)


async def with_openai(audio_file_path: str, out_dir: str):
    key = get_env_var("OPENAI_API_KEY")
    model = get_env_var("OPENAI_MODEL")
    async with RTClient(key_credential=AzureKeyCredential(key), model=model) as client:
        await run(client, audio_file_path, out_dir)


if __name__ == "__main__":
    load_dotenv()
    if len(sys.argv) < 3:
        print(f"Usage: python {sys.argv[0]} <audio_file> <out_dir> [azure|openai]")
        print("If the third argument is not provided, it will default to azure")
        sys.exit(1)

    file_path = sys.argv[1]
    out_dir = sys.argv[2]
    provider = sys.argv[3] if len(sys.argv) == 4 else "azure"

    if not os.path.isfile(file_path):
        print(f"File {file_path} does not exist")
        sys.exit(1)

    if not os.path.isdir(out_dir):
        print(f"Directory {out_dir} does not exist")
        sys.exit(1)

    if provider not in ["azure", "openai"]:
        print(f"Provider {provider} needs to be one of 'azure' or 'openai'")
        sys.exit(1)

    if provider == "azure":
        asyncio.run(with_azure_openai(file_path, out_dir))
    else:
        asyncio.run(with_openai(file_path, out_dir))
