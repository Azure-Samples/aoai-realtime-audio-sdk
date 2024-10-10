# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import base64
import uuid
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable
from typing import Coroutine, Literal, Optional, TypeGuard, Union

from azure.core.credentials import AzureKeyCredential
from azure.core.credentials_async import AsyncTokenCredential

from rtclient.low_level_client import RTLowLevelClient
from rtclient.models import (
    AssistantContentPart,
    AssistantMessageItem,
    AudioFormat,
    ClientMessageBase,
    ErrorMessage,
    FunctionCallItem,
    FunctionCallOutputItem,
    FunctionToolChoice,
    InputAudioBufferAppendMessage,
    InputAudioBufferClearedMessage,
    InputAudioBufferClearMessage,
    InputAudioBufferCommitMessage,
    InputAudioBufferCommittedMessage,
    InputAudioBufferSpeechStartedMessage,
    InputAudioBufferSpeechStoppedMessage,
    InputAudioContentPart,
    InputAudioTranscription,
    InputTextContentPart,
    Item,
    ItemCreatedMessage,
    ItemCreateMessage,
    ItemDeletedMessage,
    ItemDeleteMessage,
    ItemInputAudioTranscriptionCompletedMessage,
    ItemInputAudioTranscriptionFailedMessage,
    ItemParamStatus,
    ItemTruncatedMessage,
    ItemTruncateMessage,
    MessageItem,
    MessageItemType,
    MessageRole,
    Modality,
    NoTurnDetection,
    OutputTextContentPart,
    RateLimits,
    RateLimitsUpdatedMessage,
    RealtimeError,
    Response,
    ResponseAudioDeltaMessage,
    ResponseAudioDoneMessage,
    ResponseAudioTranscriptDeltaMessage,
    ResponseAudioTranscriptDoneMessage,
    ResponseCancelledDetails,
    ResponseCancelMessage,
    ResponseContentPartAddedMessage,
    ResponseContentPartDoneMessage,
    ResponseCreatedMessage,
    ResponseCreateMessage,
    ResponseCreateParams,
    ResponseDoneMessage,
    ResponseFailedDetails,
    ResponseFunctionCallArgumentsDeltaMessage,
    ResponseFunctionCallArgumentsDoneMessage,
    ResponseFunctionCallItem,
    ResponseFunctionCallOutputItem,
    ResponseIncompleteDetails,
    ResponseItem,
    ResponseItemAudioContentPart,
    ResponseItemBase,
    ResponseItemContentPart,
    ResponseItemInputAudioContentPart,
    ResponseItemInputTextContentPart,
    ResponseItemStatus,
    ResponseItemTextContentPart,
    ResponseMessageItem,
    ResponseOutputItemAddedMessage,
    ResponseOutputItemDoneMessage,
    ResponseStatus,
    ResponseStatusDetails,
    ResponseTextDeltaMessage,
    ResponseTextDoneMessage,
    ServerMessageBase,
    ServerMessageType,
    ServerVAD,
    Session,
    SessionCreatedMessage,
    SessionUpdatedMessage,
    SessionUpdateMessage,
    SessionUpdateParams,
    SystemContentPart,
    SystemMessageItem,
    Temperature,
    ToolChoice,
    ToolsDefinition,
    TurnDetection,
    Usage,
    UserContentPart,
    UserMessageItem,
    UserMessageType,
    Voice,
    create_message_from_dict,
)
from rtclient.util.id_generator import generate_id
from rtclient.util.message_queue import MessageQueue, MessageQueueWithError


class RealtimeException(Exception):
    def __init__(self, error: RealtimeError):
        self.error = error
        super().__init__(error.message)

    @property
    def message(self):
        return self.error.message

    @property
    def type(self):
        return self.error.type

    @property
    def code(self):
        return self.error.code

    @property
    def param(self):
        return self.error.param

    @property
    def event_id(self):
        return self.error.event_id


RTMessageContentChunkType = Literal["audio_transcript", "text", "audio", "tool_call_arguments"]


class RTMessageContentChunk:
    def __init__(self, type: RTMessageContentChunkType, data: str, index: int):
        self.type = type
        self.data = data
        self.index = index


class RTInputItem:
    def __init__(
        self,
        id: str,
        audio_start_ms: int,
        has_transcription: bool,
        receive: Callable[[], Awaitable[Optional[ServerMessageType]]],
    ):
        self.id = id
        self._has_transcription = has_transcription
        self._receive = receive
        self.previous_id: Optional[str] = None
        self.audio_start_ms = audio_start_ms
        self.audio_end_ms: Optional[int] = None
        self.transcript: Optional[str] = None
        self.commited: bool = False
        self.error: Optional[RealtimeError] = None

    def __await__(self):
        async def resolve():
            while True:
                server_message = await self._receive()
                if server_message is None:
                    break
                match server_message.type:
                    case "input_audio_buffer.speech_stopped":
                        self.audio_end_ms = server_message.audio_end_ms
                    case "conversation.item.created":
                        self.previous_id = server_message.previous_item_id
                        if not self._has_transcription:
                            return
                    case "conversation.item.input_audio_transcription.completed":
                        self.transcript = server_message.transcript
                        return
                    case "conversation.item.input_audio_transcription.failed":
                        self.error = server_message.error
                        return
                    case "input_audio_buffer.committed":
                        self.commited = True
                    case _:
                        pass

        return resolve().__await__()


class RTOutputItem:
    def __init__(
        self,
        response_id: str,
        item: ResponseItem,
        previous_id: Optional[str],
        queue: MessageQueueWithError[ServerMessageType],
    ):
        self.response_id = response_id
        self._item = item
        self.previous_id = previous_id
        self.__queue = queue

    @property
    def id(self) -> str:
        return self._item.id

    # TODO: Add more properties here

    def __aiter__(self) -> AsyncIterator[RTMessageContentChunk]:
        return self

    async def __anext__(self):
        message = await self.__queue.receive(lambda m: (m.type == "response.content_part.added" and m.item_id == self.id) or (m.type == "response.output_item.done" and m.item.id == self.id))
        if message is None:
            raise StopAsyncIteration
        if message.type == "error":
            raise RealtimeException(message.error)
        if message.type == "response.output_item.done":
            self._item = message.item
            raise StopAsyncIteration
        assert(message.type == "response.content_part.added")
        if message.part.type == "audio":
            return RTAudioContent()
        elif message.part.type == "text":
            return RTTextContent(message.part.text)

class RTResponse:
    def __init__(
        self,
        response: Response,
        queue: MessageQueueWithError[ServerMessageType],
        client: RTLowLevelClient,
    ):
        self._response = response
        self.__queue = queue
        self._client = client
        self._done = False

    @property
    def id(self) -> str:
        return self._response.id

    @property
    def status(self) -> ResponseStatus:
        return self._response.status

    @property
    def status_details(self) -> Optional[ResponseStatusDetails]:
        return self._response.status_details

    @property
    def output(self) -> list[ResponseItem]:
        return self._response.output

    @property
    def usage(self) -> Usage:
        return self._response.usage

    async def cancel(self) -> None:
        await self._client.send(ResponseCancelMessage(response_id=self.id))
        # We drain the queue to ensure that the response is marked as cancelled
        async for _ in self:
            pass

    def __aiter__(self) -> AsyncIterator[RTOutputItem]:
        return self

    async def __anext__(self):
        if self._done:
            raise StopAsyncIteration
        message = await self.__queue.receive(lambda m: m.type in ["response.done", "response.output_item.added"])
        if message is None:
            raise StopAsyncIteration
        if message.type == "error":
            raise RealtimeException(message.error)
        if message.type == "response.done":
            self._done = True
            self._response = message.response
            raise StopAsyncIteration
        if message.type == "response.output_item.added":
            # TODO: This can probably be generalized and reused (similar to the input item pattern)
            created_message = await self.__queue.receive(
                lambda m: m.type == "conversation.item.created" and m.item.id == message.item.id
            )
            if created_message is None:
                raise StopAsyncIteration
            if created_message.type == "error":
                raise RealtimeException(created_message.error)
            assert created_message.type == "conversation.item.created"
            if created_message.item.type == "message":
                return RTMessageItem(self.id, created_message.item, created_message.previous_item_id, self.__queue)
            elif created_message.item.type == "function_call":
                return RTFunctionCallItem(self.id, created_message.item, created_message.previous_item_id, self.__queue)
            elif created_message.item.type == "function_call_output":
                return RTFunctionCallOutputItem(self.id, created_message.item, created_message.previous_item_id, self.__queue)
            else:
                raise ValueError(f"Unexpected item type {created_message.item.type}")
        raise ValueError(f"Unexpected message type {message.type}")


class RTClient:
    def __init__(
        self,
        url: Optional[str] = None,
        token_credential: Optional[AsyncTokenCredential] = None,
        key_credential: Optional[AzureKeyCredential] = None,
        model: Optional[str] = None,
        azure_deployment: Optional[str] = None,
    ):
        self._client = RTLowLevelClient(url, token_credential, key_credential, model, azure_deployment)

        self._message_queue = MessageQueueWithError(self._receive_message, lambda m: m.type == "error")

        self.session: Optional[Session] = None

        self._response_map: dict[str, str] = {}
        self._transcription_enabled = False

    @property
    def request_id(self) -> uuid.UUID | None:
        return self._client.request_id

    async def _receive_message(self):
        async for message in self._client:
            return message
        return None

    async def configure(
        self,
        model: Optional[str] = None,
        modalities: Optional[set[Modality]] = None,
        voice: Optional[Voice] = None,
        instructions: Optional[str] = None,
        input_audio_format: Optional[AudioFormat] = None,
        output_audio_format: Optional[AudioFormat] = None,
        input_audio_transcription: Optional[InputAudioTranscription] = None,
        turn_detection: Optional[TurnDetection] = None,
        tools: Optional[ToolsDefinition] = None,
        tool_choice: Optional[ToolChoice] = None,
        temperature: Optional[Temperature] = None,
        max_response_output_tokens: Optional[int] = None,
    ) -> Session:
        self._transcription_enabled = input_audio_transcription is not None
        session_update_params = SessionUpdateParams()
        if model is not None:
            session_update_params.model = model
        if modalities is not None:
            session_update_params.modalities = modalities
        if voice is not None:
            session_update_params.voice = voice
        if instructions is not None:
            session_update_params.instructions = instructions
        if input_audio_format is not None:
            session_update_params.input_audio_format = input_audio_format
        if output_audio_format is not None:
            session_update_params.output_audio_format = output_audio_format
        if input_audio_transcription is not None:
            session_update_params.input_audio_transcription = input_audio_transcription
        if turn_detection is not None:
            session_update_params.turn_detection = turn_detection
        if tools is not None:
            session_update_params.tools = tools
        if tool_choice is not None:
            session_update_params.tool_choice = tool_choice
        if temperature is not None:
            session_update_params.temperature = temperature
        if max_response_output_tokens is not None:
            session_update_params.max_response_output_tokens = max_response_output_tokens
        await self._client.send(SessionUpdateMessage(session=session_update_params))

        # HACK: Azure OpenAI does not send session.updated message yet
        if self._client._is_azure_openai:
            self.session = session_update_params
            return session_update_params

        message = await self._message_queue.receive(lambda m: m.type == "session.updated")
        if message.type == "error":
            raise RealtimeException(message.error)
        assert message.type == "session.updated"
        self.session = message.session
        return message.session

    async def send_audio(self, audio: bytes) -> None:
        base64_encoded = base64.b64encode(audio).decode("utf-8")
        await self._client.send(InputAudioBufferAppendMessage(audio=base64_encoded))

    async def commit_audio(self) -> str:
        await self._client.send(InputAudioBufferCommitMessage())
        message = await self._message_queue.receive(lambda m: m.type == "input_audio_buffer.committed")
        if message.type == "error":
            raise RealtimeException(message.error)
        assert message.type == "input_audio_buffer.committed"
        return message.item_id

    async def clear_audio(self) -> None:
        await self._client.send(InputAudioBufferClearMessage())
        message = await self._message_queue.receive(lambda m: m.type == "input_audio_buffer.cleared")
        if message.type == "error":
            raise RealtimeException(message.error)
        assert message.type == "input_audio_buffer.cleared"

    # TODO: Consider splitting this into one method per type of item.
    async def send_item(self, item: Item, previous_item_id: Optional[str] = None) -> ResponseItem:
        item.id = item.id or generate_id("item")
        await self._client.send(ItemCreateMessage(previous_item_id=previous_item_id, item=item))
        message = await self._message_queue.receive(
            lambda m: m.type == "conversation.item.created" and m.item.id == item.id
        )
        if message.type == "error":
            raise RealtimeException(message.error)
        assert message.type == "conversation.item.created"
        # TODO: Use input item wrapper
        return message.item

    async def remove_item(self, item_id: str) -> None:
        await self._client.send(ItemDeleteMessage(item_id=item_id))
        message = await self._message_queue.receive(
            lambda m: m.type == "conversation.item.deleted" and m.item_id == item_id
        )
        if message.type == "error":
            raise RealtimeException(message.error)
        assert message.type == "conversation.item.deleted"

    async def generate_response(self) -> RTResponse:
        await self._client.send(ResponseCreateMessage())
        message = await self._message_queue.receive(lambda m: m.type == "response.created")
        if message.type == "error":
            raise RealtimeException(message.error)
        assert message.type == "response.created"
        return RTResponse(message.response, self._message_queue, self._client)

    # async def control_messages(self) -> AsyncIterable[ServerMessageType]:
    #     while True:
    #         message = await self._message_queue.receive("SESSION")
    #         if message is None:
    #             break
    #         yield message

    # async def items(self) -> AsyncIterable[RTInputItem | RTResponse]:
    #     while True:
    #         message = await self._message_queue.receive("SESSION-ITEM")
    #         if message is None:
    #             break
    #         elif message.type == "input_audio_buffer.speech_started":
    #             item_id = message.item_id
    #             yield RTInputItem(
    #                 item_id,
    #                 message.audio_start_ms,
    #                 self._transcription_enabled,
    #                 lambda: self._item_queue.receive(item_id),
    #             )
    #         elif message.type == "response.created":
    #             response_id = message.response.id
    #             yield RTResponse(response_id, None, lambda: self._item_queue.receive(response_id))
    #         else:
    #             raise ValueError(f"Unexpected message type {message.type}")

    async def connect(self):
        await self._client.connect()
        message = await self._message_queue.receive(lambda m: m.type == "session.created")
        if message.type == "error":
            raise RealtimeException(message.error)
        self.session = message.session

    async def close(self):
        await self._client.close()

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *args):
        await self.close()


__all__ = [
    "RealtimeException",
    "Voice",
    "AudioFormat",
    "Modality",
    "NoTurnDetection",
    "ServerVAD",
    "TurnDetection",
    "FunctionToolChoice",
    "ToolChoice",
    "MessageRole",
    "InputAudioTranscription",
    "ClientMessageBase",
    "Temperature",
    "ToolsDefinition",
    "SessionUpdateParams",
    "SessionUpdateMessage",
    "InputAudioBufferAppendMessage",
    "InputAudioBufferCommitMessage",
    "InputAudioBufferClearMessage",
    "MessageItemType",
    "InputTextContentPart",
    "InputAudioContentPart",
    "OutputTextContentPart",
    "SystemContentPart",
    "UserContentPart",
    "AssistantContentPart",
    "ItemParamStatus",
    "SystemMessageItem",
    "UserMessageItem",
    "AssistantMessageItem",
    "MessageItem",
    "FunctionCallItem",
    "FunctionCallOutputItem",
    "Item",
    "ItemCreateMessage",
    "ItemTruncateMessage",
    "ItemDeleteMessage",
    "ResponseCreateParams",
    "ResponseCreateMessage",
    "ResponseCancelMessage",
    "RealtimeError",
    "ServerMessageBase",
    "ErrorMessage",
    "Session",
    "SessionCreatedMessage",
    "SessionUpdatedMessage",
    "InputAudioBufferCommittedMessage",
    "InputAudioBufferClearedMessage",
    "InputAudioBufferSpeechStartedMessage",
    "InputAudioBufferSpeechStoppedMessage",
    "ResponseItemStatus",
    "ResponseItemInputTextContentPart",
    "ResponseItemInputAudioContentPart",
    "ResponseItemTextContentPart",
    "ResponseItemAudioContentPart",
    "ResponseItemContentPart",
    "ResponseItemBase",
    "ResponseMessageItem",
    "ResponseFunctionCallItem",
    "ResponseFunctionCallOutputItem",
    "ResponseItem",
    "ItemCreatedMessage",
    "ItemTruncatedMessage",
    "ItemDeletedMessage",
    "ItemInputAudioTranscriptionCompletedMessage",
    "ItemInputAudioTranscriptionFailedMessage",
    "ResponseStatus",
    "ResponseCancelledDetails",
    "ResponseIncompleteDetails",
    "ResponseFailedDetails",
    "ResponseStatusDetails",
    "Usage",
    "Response",
    "ResponseCreatedMessage",
    "ResponseDoneMessage",
    "ResponseOutputItemAddedMessage",
    "ResponseOutputItemDoneMessage",
    "ResponseContentPartAddedMessage",
    "ResponseContentPartDoneMessage",
    "ResponseTextDeltaMessage",
    "ResponseTextDoneMessage",
    "ResponseAudioTranscriptDeltaMessage",
    "ResponseAudioTranscriptDoneMessage",
    "ResponseAudioDeltaMessage",
    "ResponseAudioDoneMessage",
    "ResponseFunctionCallArgumentsDeltaMessage",
    "ResponseFunctionCallArgumentsDoneMessage",
    "RateLimits",
    "RateLimitsUpdatedMessage",
    "UserMessageType",
    "ServerMessageType",
    "create_message_from_dict",
]
