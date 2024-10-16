# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import os
import sys
import time

import numpy as np
import soundfile as sf
from azure.core.credentials import AzureKeyCredential
from dotenv import load_dotenv

from rtclient import (
    InputTextContentPart,
    RTAudioContent,
    RTClient,
    RTFunctionCallItem,
    RTMessageItem,
    RTResponse,
    UserMessageItem,
)

start_time = time.time()


def log(*args):
    elapsed_time_ms = int((time.time() - start_time) * 1000)
    print(f"{elapsed_time_ms} [ms]: ", *args)


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


async def run(client: RTClient, instructions_file_path: str, user_message_file_path: str, out_dir: str):
    with open(instructions_file_path, encoding = "utf-8") as instructions_file, open(user_message_file_path, encoding = "utf-8") as user_message_file:
        instructions = instructions_file.read()
        user_message = user_message_file.read()
        log("Configuring Session...")
        await client.configure(
            instructions=instructions,
        )
        log("Done")
        log("Sending User Message...")
        await client.send_item(UserMessageItem(content=[InputTextContentPart(text=user_message)]))
        log("Done")
        response = await client.generate_response()
        await receive_response(client, response, out_dir)


def get_env_var(var_name: str) -> str:
    value = os.environ.get(var_name)
    if not value:
        raise OSError(f"Environment variable '{var_name}' is not set or is empty.")
    return value


async def with_azure_openai(instructions_file_path: str, user_message_file_path: str, out_dir: str):
    endpoint = get_env_var("AZURE_OPENAI_ENDPOINT")
    key = get_env_var("AZURE_OPENAI_API_KEY")
    deployment = get_env_var("AZURE_OPENAI_DEPLOYMENT")
    async with RTClient(url=endpoint, key_credential=AzureKeyCredential(key), azure_deployment=deployment) as client:
        await run(client, instructions_file_path, user_message_file_path, out_dir)


async def with_openai(instructions_file_path: str, user_message_file_path: str, out_dir: str):
    key = get_env_var("OPENAI_API_KEY")
    model = get_env_var("OPENAI_MODEL")
    async with RTClient(key_credential=AzureKeyCredential(key), model=model) as client:
        await run(client, instructions_file_path, user_message_file_path, out_dir)


if __name__ == "__main__":
    load_dotenv()
    if len(sys.argv) < 3:
        log(f"Usage: python {sys.argv[0]} <instructions_file> <message_file> <out_dir> [azure|openai]")
        log("If the last argument is not provided, it will default to azure")
        sys.exit(1)

    instructions_file_path = sys.argv[1]
    user_message_file_path = sys.argv[2]
    out_dir = sys.argv[3]
    provider = sys.argv[4] if len(sys.argv) == 4 else "azure"

    if not os.path.isfile(instructions_file_path):
        log(f"File {instructions_file_path} does not exist")
        sys.exit(1)

    if not os.path.isfile(user_message_file_path):
        log(f"File {user_message_file_path} does not exist")
        sys.exit(1)

    if not os.path.isdir(out_dir):
        log(f"Directory {out_dir} does not exist")
        sys.exit(1)

    if provider not in ["azure", "openai"]:
        log(f"Provider {provider} needs to be one of 'azure' or 'openai'")
        sys.exit(1)

    if provider == "azure":
        asyncio.run(with_azure_openai(instructions_file_path, user_message_file_path, out_dir))
    else:
        asyncio.run(with_openai(instructions_file_path, user_message_file_path, out_dir))
