# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import base64
import uuid
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable
from typing import Literal, Optional

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
from rtclient.util.message_queue import MessageQueue

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
        id: str,
        response_id: str,
        previous_id: Optional[str],
        receive: Callable[[], Awaitable[Optional[ServerMessageType]]],
    ):
        self.id = id
        self.response_id = response_id
        self.previous_id = previous_id
        self.receive = receive

    def __aiter__(self) -> AsyncIterator[RTMessageContentChunk]:
        return self

    async def __anext__(self):
        while True:
            # TODO: This loop is to allow ignoring some of the inner response messages,
            # next iteration should properly extract meaning out of them and expose via relevant abstractions.
            server_message = await self.receive()
            if server_message is None or server_message.type == "response.output_item.done":
                raise StopAsyncIteration
            # TODO: Need to separate chunks from control here too
            if server_message.type == "conversation.item.created":
                self.previous_id = server_message.previous_item_id
            elif server_message.type == "response.audio_transcript.delta":
                return RTMessageContentChunk("audio_transcript", server_message.delta, server_message.content_index)
            elif server_message.type == "response.audio.delta":
                return RTMessageContentChunk("audio", server_message.delta, server_message.content_index)
            elif server_message.type == "response.text.delta":
                return RTMessageContentChunk("text", server_message.delta, server_message.content_index)
            elif server_message.type == "response.function_call_arguments.delta":
                return RTMessageContentChunk("tool_call_arguments", server_message.delta, server_message.output_index)


class RTResponse:
    def __init__(
        self,
        id: str,
        previous_id: Optional[str],
        receive: Callable[[], Awaitable[Optional[ServerMessageType]]],
    ):
        self.id = id
        self.previous_id = previous_id
        self._receive = receive
        self._response_queue = MessageQueue(lambda: self._receive_response_message(), self._response_message_classifier)
        self._item_queue = MessageQueue(lambda: self._response_queue.receive("ITEM"), self._item_id_extractor)

    async def _receive_response_message(self):
        return await self._receive()

    def _response_message_classifier(self, message: ServerMessageType) -> Optional[str]:
        if message.type in [
            "response.done",
            "response.output_item.added",
        ]:
            return "RESPONSE"
        elif message.type in [
            "conversation.item.created",
            "conversation.item.truncated",
            "conversation.item.deleted",
            "response.output_item.done",
            "response.content_part.added",
            "response.content_part.done",
            "response.audio_transcript.delta",
            "response.audio_transcript.done",
            "response.audio.delta",
            "response.audio.done",
            "response.function_call_arguments.delta",
            "response.function_call_arguments.done",
            "response.text.delta",
            "response.text.done",
        ]:
            return "ITEM"
        return None

    def _item_id_extractor(self, message: ServerMessageType) -> Optional[str]:
        if message.type in [
            "conversation.item.created",
            "response.output_item.done",
        ]:
            return message.item.id
        elif message.type in [
            "conversation.item.truncated",
            "conversation.item.deleted",
            "response.content_part.added",
            "response.content_part.done",
            "response.audio_transcript.delta",
            "response.audio_transcript.done",
            "response.audio.delta",
            "response.audio.done",
            "response.function_call_arguments.delta",
            "response.function_call_arguments.done",
            "response.text.delta",
            "response.text.done",
        ]:
            return message.item_id
        else:
            return None

    def __aiter__(self) -> AsyncIterator[RTOutputItem]:
        return self

    async def __anext__(self):
        control_message = await self._response_queue.receive("RESPONSE")
        if control_message is None or control_message.type == "response.done":
            raise StopAsyncIteration
        if control_message.type == "response.output_item.added":
            item_id = control_message.item.id
            return RTOutputItem(item_id, self.id, None, lambda: self._item_queue.receive(item_id))
        raise ValueError(f"Unexpected message type {control_message.type}")


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

        self._message_queue = MessageQueue(self._receive_message, self._message_id_extractor)

        self._item_queue = MessageQueue(self._receive_item_message, self._item_id_extractor)

        self._response_map: dict[str, str] = {}
        self._transcription_enabled = False

    @property
    def request_id(self) -> uuid.UUID | None:
        return self._client.request_id

    async def _receive_message(self):
        async for message in self._client:
            return message
        return None

    def _message_id_extractor(self, message: ServerMessageType) -> Optional[str]:
        if message.type in [
            "session.created",
            "input_audio_buffer.cleared",
            "rate_limits.updated",
            "error",
        ]:
            return "SESSION"
        elif message.type in [
            "input_audio_buffer.speech_started",
            "response.created",
        ]:
            return "SESSION-ITEM"
        elif message.type in [
            "response.done",
            "response.output_item.added",
            "input_audio_buffer.speech_stopped",
            "input_audio_buffer.committed",
            "conversation.item.created",
            "conversation.item.truncated",
            "conversation.item.deleted",
            "conversation.item.input_audio_transcription.completed",
            "conversation.item.input_audio_transcription.failed",
            "response.output_item.done",
            "response.content_part.added",
            "response.content_part.done",
            "response.audio_transcript.delta",
            "response.audio_transcript.done",
            "response.audio.delta",
            "response.audio.done",
            "response.function_call_arguments.delta",
            "response.function_call_arguments.done",
            "response.text.delta",
            "response.text.done",
        ]:
            return "ITEM"
        return None

    async def _receive_item_message(self):
        return await self._message_queue.receive("ITEM")

    def _item_id_extractor(self, message: ServerMessageType) -> Optional[str]:
        match message.type:
            case "response.done":
                return message.response.id
            case "response.output_item.added":
                self._response_map[message.item.id] = message.response_id
                return message.response_id
            case "input_audio_buffer.speech_stopped":
                return message.item_id
            case "input_audio_buffer.committed":
                return message.item_id
            case "conversation.item.created":
                if message.item.id in self._response_map:
                    return self._response_map[message.item.id]
                return message.item.id
            case "conversation.item.truncated":
                if message.item_id in self._response_map:
                    return self._response_map[message.item_id]
                return message.item_id
            case "conversation.item.deleted":
                if message.item_id in self._response_map:
                    return self._response_map[message.item_id]
                return message.item_id
            case "conversation.item.input_audio_transcription.completed":
                return message.item_id
            case "conversation.item.input_audio_transcription.failed":
                return message.item_id
            case "response.output_item.done":
                self._response_map.pop(message.item.id, None)
                return message.response_id
            case "response.content_part.added":
                return message.response_id
            case "response.content_part.done":
                return message.response_id
            case "response.audio_transcript.delta":
                return message.response_id
            case "response.audio_transcript.done":
                return message.response_id
            case "response.audio.delta":
                return message.response_id
            case "response.audio.done":
                return message.response_id
            case "response.function_call_arguments.delta":
                return message.response_id
            case "response.function_call_arguments.done":
                return message.response_id
            case "response.text.delta":
                return message.response_id
            case "response.text.done":
                return message.response_id
            case _:
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
    ):
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

    async def send_audio(self, audio: bytes):
        base64_encoded = base64.b64encode(audio).decode("utf-8")
        await self._client.send(InputAudioBufferAppendMessage(audio=base64_encoded))

    async def commit_audio(self):
        await self._client.send(InputAudioBufferCommitMessage())

    async def clear_audio(self):
        await self._client.send(InputAudioBufferClearMessage())

    async def send_item(self, item: Item):
        await self._client.send(ItemCreateMessage(item=item))

    async def remove_item(self, item_id: str):
        await self._client.send(ItemDeleteMessage(item_id=item_id))

    async def generate_response(self):
        await self._client.send(ResponseCreateMessage())

    async def control_messages(self) -> AsyncIterable[ServerMessageType]:
        while True:
            message = await self._message_queue.receive("SESSION")
            if message is None:
                break
            yield message

    async def items(self) -> AsyncIterable[RTInputItem | RTResponse]:
        while True:
            message = await self._message_queue.receive("SESSION-ITEM")
            if message is None:
                break
            elif message.type == "input_audio_buffer.speech_started":
                item_id = message.item_id
                yield RTInputItem(
                    item_id,
                    message.audio_start_ms,
                    self._transcription_enabled,
                    lambda: self._item_queue.receive(item_id),
                )
            elif message.type == "response.created":
                response_id = message.response.id
                yield RTResponse(response_id, None, lambda: self._item_queue.receive(response_id))
            else:
                raise ValueError(f"Unexpected message type {message.type}")

    async def connect(self):
        await self._client.connect()

    async def close(self):
        await self._client.close()

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *args):
        await self.close()


__all__ = [
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
