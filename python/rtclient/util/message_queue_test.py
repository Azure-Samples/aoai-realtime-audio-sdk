# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio

import pytest
from message_queue import MessageQueue


class Message:
    def __init__(self, id: str, content: str):
        self.id = id
        self.content = content


@pytest.fixture
def message_queue():
    async def receive_delegate():
        await asyncio.sleep(0.1)
        return None

    def id_extractor(message):
        return message.id if isinstance(message, Message) else None

    return MessageQueue(receive_delegate, id_extractor)


@pytest.mark.asyncio
async def test_receive_existing_message(message_queue):
    message = Message("1", "Hello")
    message_queue._push_back("1", message)

    result = await message_queue.receive("1")
    assert result == message
    assert message_queue.queued_messages_count() == 0


@pytest.mark.asyncio
async def test_receive_non_existing_message(message_queue):
    messages = [Message("2", "World")]
    message_queue.receive_delegate = lambda: asyncio.sleep(0, messages.pop(0) if messages else None)

    result = await message_queue.receive("2")
    assert isinstance(result, Message)
    assert result.id == "2"
    assert result.content == "World"


@pytest.mark.asyncio
async def test_receive_multiple_messages(message_queue):
    messages = [Message("1", "First"), Message("2", "Second"), Message("3", "Third")]
    for message in messages:
        message_queue._push_back(message.id, message)

    result1 = await message_queue.receive("2")
    result2 = await message_queue.receive("1")
    result3 = await message_queue.receive("3")

    assert result1 == messages[1]
    assert result2 == messages[0]
    assert result3 == messages[2]
    assert message_queue.queued_messages_count() == 0


@pytest.mark.asyncio
async def test_receive_end_of_stream(message_queue):
    result = await message_queue.receive("1")
    assert result is None


@pytest.mark.asyncio
async def test_receive_with_error(message_queue):
    async def receive_delegate():
        raise Exception("Test error")

    message_queue.receive_delegate = receive_delegate

    with pytest.raises(Exception, match="Test error"):
        await message_queue.receive("1")


@pytest.mark.asyncio
async def test_multiple_receivers_same_id(message_queue):
    messages = [Message("1", "Shared")]
    message_queue.receive_delegate = lambda: asyncio.sleep(0, messages.pop(0) if messages else None)

    task1 = asyncio.create_task(message_queue.receive("1"))
    task2 = asyncio.create_task(message_queue.receive("1"))

    result1, result2 = await asyncio.gather(task1, task2)

    assert result1.content == "Shared"
    assert result2 is None  # Second receiver gets None as the message was already consumed


@pytest.mark.asyncio
async def test_id_extractor_returns_none(message_queue):
    messages = [Message("1", "Ignored")]
    message_queue.receive_delegate = lambda: asyncio.sleep(0, messages.pop(0) if messages else None)

    def id_extractor(msg):
        return None

    message_queue.id_extractor = id_extractor

    result = await message_queue.receive("1")
    assert result is None
    assert message_queue.queued_messages_count() == 0


@pytest.mark.asyncio
async def test_polling_mechanism(message_queue):
    messages = [Message("2", "Second"), Message("1", "First"), Message("3", "Third")]

    async def delayed_receive_delegate():
        await asyncio.sleep(0.1)
        return messages.pop(0) if messages else None

    message_queue.receive_delegate = delayed_receive_delegate

    task1 = asyncio.create_task(message_queue.receive("1"))
    await asyncio.sleep(0.05)  # Ensure task1 starts polling
    task2 = asyncio.create_task(message_queue.receive("2"))
    task3 = asyncio.create_task(message_queue.receive("3"))

    results = await asyncio.gather(task1, task2, task3)

    assert [msg.content for msg in results if msg] == ["First", "Second", "Third"]
    assert not message_queue.is_polling
    assert message_queue.poll_task is None


@pytest.mark.asyncio
async def test_polling_stops_when_no_receivers(message_queue):
    messages = [Message("1", "First"), Message("2", "Second")]

    async def delayed_receive_delegate():
        await asyncio.sleep(0.1)
        return messages.pop(0) if messages else None

    message_queue.receive_delegate = delayed_receive_delegate

    result1 = await message_queue.receive("1")
    assert result1.content == "First"
    assert not message_queue.is_polling
    assert message_queue.poll_task is None

    result2 = await message_queue.receive("2")
    assert result2.content == "Second"
    assert not message_queue.is_polling
    assert message_queue.poll_task is None


@pytest.mark.asyncio
async def test_concurrent_receive_calls(message_queue):
    messages = [Message("1", "First"), Message("2", "Second"), Message("3", "Third")]

    async def delayed_receive_delegate():
        await asyncio.sleep(0.1)
        return messages.pop(0) if messages else None

    message_queue.receive_delegate = delayed_receive_delegate

    tasks = [
        asyncio.create_task(message_queue.receive("1")),
        asyncio.create_task(message_queue.receive("2")),
        asyncio.create_task(message_queue.receive("3")),
        asyncio.create_task(message_queue.receive("4")),  # This one should receive None
    ]

    results = await asyncio.gather(*tasks)

    assert [msg.content if msg else None for msg in results] == ["First", "Second", "Third", None]
    assert not message_queue.is_polling
    assert message_queue.poll_task is None
