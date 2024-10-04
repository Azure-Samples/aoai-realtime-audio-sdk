# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import base64
import os
import sys
import time

import numpy as np
import soundfile as sf
from azure.core.credentials import AzureKeyCredential
from dotenv import load_dotenv

from rtclient import InputTextContentPart, RTClient, RTInputItem, RTOutputItem, RTResponse, UserMessageItem

start_time = time.time()


def log(message):
    elapsed_time_ms = int((time.time() - start_time) * 1000)
    log(f"{elapsed_time_ms} [ms]: {message}", flush=True)


async def receive_control(client: RTClient):
    async for control in client.control_messages():
        if control is not None:
            log(f"Received a control message: {control.type}")
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
        log(prefix, f"Text: {text_data}")
        with open(os.path.join(out_dir, f"{item.id}.text.txt"), "w", encoding="utf-8") as out:
            out.write(text_data)
    if audio_data is not None:
        log(prefix, f"Audio received with length: {len(audio_data)}")
        with open(os.path.join(out_dir, f"{item.id}.wav"), "wb") as out:
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            sf.write(out, audio_array, samplerate=24000)
    if audio_transcript is not None:
        log(prefix, f"Audio Transcript: {audio_transcript}")
        with open(os.path.join(out_dir, f"{item.id}.audio_transcript.txt"), "w", encoding="utf-8") as out:
            out.write(audio_transcript)
    if arguments is not None:
        log(prefix, f"Tool Call Arguments: {arguments}")
        with open(os.path.join(out_dir, f"{item.id}.tool.streamed.json"), "w", encoding="utf-8") as out:
            out.write(arguments)


async def receive_response(client: RTClient, response: RTResponse, out_dir: str):
    prefix = f"[response={response.id}]"
    async for item in response:
        log(prefix, f"Received item {item.id}")
        asyncio.create_task(receive_item(item, out_dir))
    log(prefix, "Response completed")
    await client.close()


async def receive_input_item(item: RTInputItem):
    prefix = f"[input_item={item.id}]"
    await item
    log(prefix, f"Previous Id: {item.previous_id}")
    log(prefix, f"Transcript: {item.transcript}")
    log(prefix, f"Audio Start [ms]: {item.audio_start_ms}")
    log(prefix, f"Audio End [ms]: {item.audio_end_ms}")


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


async def run(client: RTClient, instructions_file_path: str, user_message_file_path: str, out_dir: str):
    with open(instructions_file_path) as instructions_file, open(user_message_file_path) as user_message_file:
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
        await client.generate_response()
        await receive_messages(client, out_dir)


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
