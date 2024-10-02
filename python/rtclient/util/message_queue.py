# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
from collections.abc import Awaitable, Callable
from typing import Generic, Optional, TypeVar

T = TypeVar("T")


class MessageQueue(Generic[T]):
    def __init__(self, receive_delegate: Callable[[], Awaitable[T]], id_extractor: Callable[[T], Optional[str]]):
        self._stored_messages: dict[str, list[T]] = {}
        self.waiting_receivers: dict[str, list[asyncio.Future]] = {}
        self.is_polling: bool = False
        self.receive_delegate = receive_delegate
        self.id_extractor = id_extractor
        self.poll_task: Optional[asyncio.Task] = None

    def _push_back(self, id: str, message: T):
        if id not in self._stored_messages:
            self._stored_messages[id] = []
        self._stored_messages[id].append(message)

    def _pop_front(self, id: str) -> Optional[T]:
        if id not in self._stored_messages:
            return None
        message = self._stored_messages[id].pop(0)
        if not self._stored_messages[id]:
            del self._stored_messages[id]
        return message

    async def poll_receive(self):
        if self.is_polling:
            return

        try:
            self.is_polling = True
            while self.is_polling:
                message = await self.receive_delegate()
                if message is None:
                    self.notify_end_of_stream()
                    break
                self.notify_receiver(message)
                if self.get_all_waiting_receivers_count() == 0:
                    break
        except Exception as error:
            self.notify_error(error)
        finally:
            self.is_polling = False
            self.poll_task = None

    def notify_error(self, error: Exception):
        for futures in self.waiting_receivers.values():
            for future in futures:
                if not future.done():
                    future.set_exception(error)
        self.waiting_receivers.clear()

    def notify_end_of_stream(self):
        for futures in self.waiting_receivers.values():
            for future in futures:
                if not future.done():
                    future.set_result(None)
        self.waiting_receivers.clear()

    def notify_receiver(self, message: T):
        id = self.id_extractor(message)
        if id is None:
            return

        if id not in self.waiting_receivers:
            self._push_back(id, message)
            return

        future = self.waiting_receivers[id].pop(0)
        if not self.waiting_receivers[id]:
            del self.waiting_receivers[id]
        future.set_result(message)

    def get_all_waiting_receivers_count(self) -> int:
        return sum(len(futures) for futures in self.waiting_receivers.values())

    def queued_messages_count(self) -> int:
        return sum(len(messages) for messages in self._stored_messages.values())

    async def receive(self, receiver_id: str) -> Optional[T]:
        found_message = self._pop_front(receiver_id)
        if found_message is not None:
            return found_message

        future = asyncio.Future()
        if receiver_id not in self.waiting_receivers:
            self.waiting_receivers[receiver_id] = []
        self.waiting_receivers[receiver_id].append(future)

        if not self.is_polling and self.poll_task is None:
            self.poll_task = asyncio.create_task(self.poll_receive())

        return await future
