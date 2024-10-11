# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import os
import uuid
from collections.abc import AsyncIterator
from typing import Optional

from aiohttp import ClientSession, WSMsgType, WSServerHandshakeError
from azure.core.credentials import AzureKeyCredential
from azure.core.credentials_async import AsyncTokenCredential

from rtclient.models import ServerMessageType, UserMessageType, create_message_from_dict


class ConnectionError(Exception):
    def __init__(self, message: str, headers=None):
        super().__init__(message)
        self.headers = headers

    pass


class RTLowLevelClient:
    def __init__(
        self,
        url: Optional[str] = None,
        token_credential: Optional[AsyncTokenCredential] = None,
        key_credential: Optional[AzureKeyCredential] = None,
        model: Optional[str] = None,
        azure_deployment: Optional[str] = None,
    ):
        self._is_azure_openai = url is not None
        if self._is_azure_openai:
            if key_credential is None and token_credential is None:
                raise ValueError("key_credential or token_credential is required for Azure OpenAI")
            if azure_deployment is None:
                raise ValueError("azure_deployment is required for Azure OpenAI")
        else:
            if key_credential is None:
                raise ValueError("key_credential is required for OpenAI")
            if model is None:
                raise ValueError("model is required for OpenAI")

        self._url = url if self._is_azure_openai else "wss://api.openai.com"
        self._token_credential = token_credential
        self._key_credential = key_credential
        self._session = ClientSession(base_url=self._url)
        self._model = model
        self._azure_deployment = azure_deployment
        self.request_id: Optional[uuid.UUID] = None

    def _user_agent(self):
        return "ms-rtclient-0.4.5"

    async def _get_auth(self):
        if self._token_credential:
            scope = "https://cognitiveservices.azure.com/.default"
            token = await self._token_credential.get_token(scope)
            return {"Authorization": f"Bearer {token.token}"}
        elif self._key_credential:
            return {"api-key": self._key_credential.key}
        else:
            return {}

    def _get_azure_params():
        api_version = os.getenv("AZURE_OPENAI_API_VERSION")
        path = os.getenv("AZURE_OPENAI_PATH")
        return (
            "2024-10-01-preview" if api_version is None else api_version,
            "/openai/realtime" if path is None else path,
        )

    async def connect(self):
        try:
            self.request_id = uuid.uuid4()
            if self._is_azure_openai:
                api_version, path = self._get_azure_params()
                auth_headers = await self._get_auth()
                headers = {
                    "x-ms-client-request-id": str(self.request_id),
                    "User-Agent": self._user_agent(),
                    **auth_headers,
                }
                self.ws = await self._session.ws_connect(
                    path,
                    headers=headers,
                    params={"deployment": self._azure_deployment, "api-version": api_version},
                )
            else:
                headers = {
                    "Authorization": f"Bearer {self._key_credential.key}",
                    "openai-beta": "realtime=v1",
                    "User-Agent": self._user_agent(),
                }
                self.ws = await self._session.ws_connect("/v1/realtime", headers=headers, params={"model": self._model})
        except WSServerHandshakeError as e:
            await self._session.close()
            error_message = f"Received status code {e.status} from the server"
            raise ConnectionError(error_message, e.headers) from e

    async def send(self, message: UserMessageType):
        message._is_azure = self._is_azure_openai
        message_json = message.model_dump_json(exclude_unset=True)
        await self.ws.send_str(message_json)

    async def recv(self) -> ServerMessageType | None:
        if self.ws.closed:
            return None
        websocket_message = await self.ws.receive()
        if websocket_message.type == WSMsgType.TEXT:
            data = json.loads(websocket_message.data)
            msg = create_message_from_dict(data)
            return msg
        else:
            return None

    def __aiter__(self) -> AsyncIterator[ServerMessageType | None]:
        return self

    async def __anext__(self):
        message = await self.recv()
        if message is None:
            raise StopAsyncIteration
        return message

    async def close(self):
        await self.ws.close()
        await self._session.close()

    @property
    def closed(self) -> bool:
        return self.ws.closed

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *args):
        await self.close()
