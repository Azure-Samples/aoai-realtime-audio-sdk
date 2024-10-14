# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import os
import sys

import numpy as np
import soundfile as sf
from azure.core.credentials import AzureKeyCredential
from dotenv import load_dotenv
from scipy.signal import resample

from rtclient import (
    InputAudioTranscription,
    NoTurnDetection,
    RTAudioContent,
    RTClient,
    RTFunctionCallItem,
    RTInputAudioItem,
    RTMessageItem,
    RTResponse,
)


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


async def receive_message_item(item: RTMessageItem, out_dir: str):
    prefix = f"[response={item.response_id}][item={item.id}]"
    async for contentPart in item:
        if contentPart.type == "audio":

            async def collect_audio(audioContentPart: RTAudioContent):
                audio_data = bytearray()
                async for chunk in audioContentPart.audio_chunks():
                    audio_data.extend(chunk)
                return audio_data

            async def collect_transcript(audioContentPart: RTAudioContent):
                audio_transcript: str = ""
                async for chunk in audioContentPart.transcript_chunks():
                    audio_transcript += chunk
                return audio_transcript

            audio_task = asyncio.create_task(collect_audio(contentPart))
            transcript_task = asyncio.create_task(collect_transcript(contentPart))
            audio_data, audio_transcript = await asyncio.gather(audio_task, transcript_task)
            print(prefix, f"Audio received with length: {len(audio_data)}")
            print(prefix, f"Audio Transcript: {audio_transcript}")
            with open(os.path.join(out_dir, f"{item.id}_{contentPart.content_index}.wav"), "wb") as out:
                audio_array = np.frombuffer(audio_data, dtype=np.int16)
                sf.write(out, audio_array, samplerate=24000)
            with open(
                os.path.join(out_dir, f"{item.id}_{contentPart.content_index}.audio_transcript.txt"),
                "w",
                encoding="utf-8",
            ) as out:
                out.write(audio_transcript)
        elif contentPart.type == "text":
            text_data = ""
            async for chunk in contentPart.text_chunks():
                text_data += chunk
            print(prefix, f"Text: {text_data}")
            with open(
                os.path.join(out_dir, f"{item.id}_{contentPart.content_index}.text.txt"), "w", encoding="utf-8"
            ) as out:
                out.write(text_data)


async def receive_function_call_item(item: RTFunctionCallItem, out_dir: str):
    prefix = f"[function_call_item={item.id}]"
    await item
    print(prefix, f"Function call arguments: {item.arguments}")
    with open(os.path.join(out_dir, f"{item.id}.function_call.json"), "w", encoding="utf-8") as out:
        out.write(item.arguments)


async def receive_response(client: RTClient, response: RTResponse, out_dir: str):
    prefix = f"[response={response.id}]"
    async for item in response:
        print(prefix, f"Received item {item.id}")
        if item.type == "message":
            asyncio.create_task(receive_message_item(item, out_dir))
        elif item.type == "function_call":
            asyncio.create_task(receive_function_call_item(item, out_dir))

    print(prefix, f"Response completed ({response.status})")
    if response.status == "completed":
        await client.close()


async def receive_input_item(item: RTInputAudioItem):
    prefix = f"[input_item={item.id}]"
    await item
    print(prefix, f"Transcript: {item.transcript}")
    print(prefix, f"Audio Start [ms]: {item.audio_start_ms}")
    print(prefix, f"Audio End [ms]: {item.audio_end_ms}")


async def run(client: RTClient, audio_file_path: str, instructions_file: str, out_dir: str):
    with open(instructions_file) as f:
        instructions = f.read()
        print("Configuring Session...", end="", flush=True)
        await client.configure(
            instructions=instructions,
            turn_detection=NoTurnDetection(),
            input_audio_transcription=InputAudioTranscription(model="whisper-1"),
        )
        print("Done")

        await send_audio(client, audio_file_path)

        input_item = await client.commit_audio()
        response = await client.generate_response()
        await asyncio.gather(
            receive_response(client, response, out_dir),
            receive_input_item(input_item),
        )


def get_env_var(var_name: str) -> str:
    value = os.environ.get(var_name)
    if not value:
        raise OSError(f"Environment variable '{var_name}' is not set or is empty.")
    return value


async def with_azure_openai(audio_file_path: str, instructions_file: str, out_dir: str):
    endpoint = get_env_var("AZURE_OPENAI_ENDPOINT")
    key = get_env_var("AZURE_OPENAI_API_KEY")
    deployment = get_env_var("AZURE_OPENAI_DEPLOYMENT")
    async with RTClient(url=endpoint, key_credential=AzureKeyCredential(key), azure_deployment=deployment) as client:
        await run(client, audio_file_path, instructions_file, out_dir)


async def with_openai(audio_file_path: str, instructions_file: str, out_dir: str):
    key = get_env_var("OPENAI_API_KEY")
    model = get_env_var("OPENAI_MODEL")
    async with RTClient(key_credential=AzureKeyCredential(key), model=model) as client:
        await run(client, audio_file_path, instructions_file, out_dir)


if __name__ == "__main__":
    load_dotenv()
    if len(sys.argv) < 3:
        print(f"Usage: python {sys.argv[0]} <audio_file> <instructions_file> <out_dir> [azure|openai]")
        print("If the fourth argument is not provided, it will default to azure")
        sys.exit(1)

    file_path = sys.argv[1]
    instructions_file = sys.argv[2]
    out_dir = sys.argv[3]
    provider = sys.argv[4] if len(sys.argv) == 5 else "azure"

    if not os.path.isfile(file_path):
        print(f"File {file_path} does not exist")
        sys.exit(1)

    if not os.path.isfile(instructions_file):
        print(f"File {instructions_file} does not exist")
        sys.exit(1)

    if not os.path.isdir(out_dir):
        print(f"Directory {out_dir} does not exist")
        sys.exit(1)

    if provider not in ["azure", "openai"]:
        print(f"Provider {provider} needs to be one of 'azure' or 'openai'")
        sys.exit(1)

    if provider == "azure":
        asyncio.run(with_azure_openai(file_path, instructions_file, out_dir))
    else:
        asyncio.run(with_openai(file_path, instructions_file, out_dir))
