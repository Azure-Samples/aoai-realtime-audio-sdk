import asyncio
import json
import os
import uuid
from typing import Literal, TypedDict, Union

import uvicorn
from azure.core.credentials import AzureKeyCredential
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketState
from loguru import logger
from rtclient import (
    InputAudioTranscription,
    InputTextContentPart,
    RTAudioContent,
    RTClient,
    RTInputAudioItem,
    RTResponse,
    ServerVAD,
    UserMessageItem,
)

load_dotenv()


class TextDelta(TypedDict):
    id: str
    type: Literal["text_delta"]
    delta: str


class Transcription(TypedDict):
    id: str
    type: Literal["transcription"]
    text: str


class UserMessage(TypedDict):
    id: str
    type: Literal["user_message"]
    text: str


class ControlMessage(TypedDict):
    type: Literal["control"]
    action: str
    greeting: str | None = None
    id: str | None = None


WSMessage = Union[TextDelta, Transcription, UserMessage, ControlMessage]


class RTSession:
    def __init__(self, websocket: WebSocket, backend: str | None):
        self.session_id = str(uuid.uuid4())
        self.websocket = websocket
        self.logger = logger.bind(session_id=self.session_id)
        self.client = self._initialize_client(backend)
        self.logger.info("New session created")

    async def __aenter__(self):
        await self.client.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        await self.client.__aexit__(exc_type, exc_value, traceback)
        self.logger.info("Session closed")

    def _initialize_client(self, backend: str | None):
        self.logger.debug(f"Initializing RT client with backend: {backend}")

        if backend == "azure":
            azure_openai_api_key = os.getenv("AZURE_OPENAI_API_KEY")
            # If the Azure OpenAI API key is not provided, use the DefaultAzureCredential
            if not azure_openai_api_key:
                return RTClient(
                    url=os.getenv("AZURE_OPENAI_ENDPOINT"),
                    token_credential=DefaultAzureCredential(),
                    azure_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT"),
                )
            else:
                return RTClient(
                    url=os.getenv("AZURE_OPENAI_ENDPOINT"),
                    key_credential=AzureKeyCredential(azure_openai_api_key),
                    azure_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT"),
                )
        return RTClient(
            key_credential=AzureKeyCredential(os.getenv("OPENAI_API_KEY")),
            model=os.getenv("OPENAI_MODEL"),
        )

    async def send(self, message: WSMessage):
        await self.websocket.send_json(message)

    async def send_binary(self, message: bytes):
        await self.websocket.send_bytes(message)

    async def initialize(self):
        self.logger.debug("Configuring realtime session")
        await self.client.configure(
            modalities={"text", "audio"},
            voice="alloy",
            input_audio_format="pcm16",
            input_audio_transcription=InputAudioTranscription(model="whisper-1"),
            turn_detection=ServerVAD(),
        )

        greeting: ControlMessage = {
            "type": "control",
            "action": "connected",
            "greeting": "You are now connected to the FastAPI server",
        }
        await self.send(greeting)
        self.logger.debug("Realtime session configured successfully")
        asyncio.create_task(self.start_event_loop())

    async def handle_binary_message(self, message: bytes):
        try:
            await self.client.send_audio(message)
        except Exception as error:
            self.logger.error(f"Failed to send audio data: {error}")
            raise

    async def handle_text_message(self, message: str):
        try:
            parsed: WSMessage = json.loads(message)
            self.logger.debug(f"Received text message type: {parsed['type']}")

            if parsed["type"] == "user_message":
                await self.client.send_item(
                    UserMessageItem(
                        content=[InputTextContentPart(text=parsed["text"])],
                    )
                )
                # Trigger the response generation and wait for the response
                await self.client.generate_response()

                self.logger.debug("User message processed successfully")
        except Exception as error:
            self.logger.error(f"Failed to process user message: {error}")
            raise

    async def handle_text_content(self, content):
        try:
            content_id = f"{content.item_id}-{content.content_index}"
            async for text in content.text_chunks():
                delta_message: TextDelta = {
                    "id": content_id,
                    "type": "text_delta",
                    "delta": text,
                }
                await self.send(delta_message)

            await self.send(
                {"type": "control", "action": "text_done", "id": content_id}
            )
            self.logger.debug("Text content processed successfully")
        except Exception as error:
            self.logger.error(f"Error handling text content: {error}")
            raise

    async def handle_audio_content(self, content: RTAudioContent):
        async def handle_audio_chunks():
            async for chunk in content.audio_chunks():
                await self.send_binary(chunk)

        async def handle_audio_transcript():
            content_id = f"{content.item_id}-{content.content_index}"
            async for chunk in content.transcript_chunks():
                await self.send(
                    {"id": content_id, "type": "text_delta", "delta": chunk}
                )
            await self.send(
                {"type": "control", "action": "text_done", "id": content_id}
            )

        try:
            await asyncio.gather(handle_audio_chunks(), handle_audio_transcript())
            self.logger.debug("Audio content processed successfully")
        except Exception as error:
            self.logger.error(f"Error handling audio content: {error}")
            raise

    async def handle_response(self, event: RTResponse):
        try:
            async for item in event:
                if item.type == "message":
                    async for content in item:
                        if content.type == "text":
                            await self.handle_text_content(content)
                        elif content.type == "audio":
                            await self.handle_audio_content(content)
            self.logger.debug("Response handled successfully")
        except Exception as error:
            self.logger.error(f"Error handling response: {error}")
            raise

    async def handle_input_audio(self, event: RTInputAudioItem):
        try:
            await self.send({"type": "control", "action": "speech_started"})
            await event

            transcription: Transcription = {
                "id": event.id,
                "type": "transcription",
                "text": event.transcript or "",
            }
            await self.send(transcription)
            self.logger.debug(
                f"Input audio processed successfully, transcription length: {len(transcription['text'])}"
            )
        except Exception as error:
            self.logger.error(f"Error handling input audio: {error}")
            raise

    async def start_event_loop(self):
        try:
            self.logger.debug("Starting event loop")
            async for event in self.client.events():
                if event.type == "response":
                    await self.handle_response(event)
                elif event.type == "input_audio":
                    await self.handle_input_audio(event)
        except Exception as error:
            self.logger.error(f"Error in event loop: {error}")
            raise


app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/realtime")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("New WebSocket connection established")

    async with RTSession(websocket, os.getenv("BACKEND")) as session:
        try:
            await session.initialize()

            while websocket.client_state != WebSocketState.DISCONNECTED:
                message = await websocket.receive()
                if "bytes" in message:
                    await session.handle_binary_message(message["bytes"])
                elif "text" in message:
                    await session.handle_text_message(message["text"])
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()
            logger.info("WebSocket connection closed")


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
