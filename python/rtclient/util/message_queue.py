# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
from collections.abc import Awaitable, Callable
from typing import Generic, Optional, TypeVar

T = TypeVar("T")


class MessageQueue(Generic[T]):
    def __init__(self, receive_delegate: Callable[[], Awaitable[T]]):
        self._stored_messages: list[T] = []
        self.waiting_receivers: list[tuple[Callable[[T], bool], asyncio.Future]] = []
        self.is_polling: bool = False
        self.receive_delegate = receive_delegate
        self.poll_task: Optional[asyncio.Task] = None

    def _push_back(self, message: T):
        self._stored_messages.append(message)

    def _find_and_remove(self, predicate: Callable[[T], bool]) -> Optional[T]:
        for i, message in enumerate(self._stored_messages):
            if predicate(message):
                return self._stored_messages.pop(i)
        return None

    async def _poll_receive(self):
        if self.is_polling:
            return

        try:
            self.is_polling = True
            while self.is_polling:
                message = await self.receive_delegate()
                if message is None:
                    self._notify_end_of_stream()
                    break
                self._notify_receiver(message)
                if len(self.waiting_receivers) == 0:
                    break
        except Exception as error:
            self._notify_exception(error)
        finally:
            self.is_polling = False
            self.poll_task = None

    def _notify_exception(self, error: Exception):
        for _, future in self.waiting_receivers:
            if not future.done():
                future.set_exception(error)
        self.waiting_receivers.clear()

    def _notify_end_of_stream(self):
        for _, future in self.waiting_receivers:
            if not future.done():
                future.set_result(None)
        self.waiting_receivers.clear()

    def _notify_receiver(self, message: T):
        for i, (predicate, future) in enumerate(self.waiting_receivers):
            if predicate(message):
                del self.waiting_receivers[i]
                future.set_result(message)
                return
        self._push_back(message)

    def queued_messages_count(self) -> int:
        return len(self._stored_messages)

    async def receive(self, predicate: Callable[[T], bool]) -> Optional[T]:
        found_message = self._find_and_remove(predicate)
        if found_message is not None:
            return found_message

        future = asyncio.Future()
        self.waiting_receivers.append((predicate, future))

        if not self.is_polling and self.poll_task is None:
            self.poll_task = asyncio.create_task(self._poll_receive())

        return await future


class MessageQueueWithError(MessageQueue[T]):
    def __init__(self, receive_delegate: Callable[[], Awaitable[T]], error_predicate: Callable[[T], bool]):
        super().__init__(receive_delegate)
        self._error_predicate = error_predicate
        self._error: Optional[T] = None

    def _notify_error(self, error: T):
        for _, future in self.waiting_receivers:
            if not future.done():
                future.set_result(error)
        self.waiting_receivers.clear()

    async def receive(self, predicate) -> Optional[T]:
        if self._error is not None:
            return self._error
        message = await super().receive(lambda m: predicate(m) or self._error_predicate(m))
        if message is not None and self._error_predicate(message):
            self._error = message
            self._notify_error(message)
        return message
