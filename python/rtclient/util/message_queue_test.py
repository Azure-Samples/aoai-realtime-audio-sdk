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

    return MessageQueue(receive_delegate)


@pytest.mark.asyncio
async def test_receive_existing_message(message_queue):
    message = Message("1", "Hello")
    message_queue._push_back(message)

    result = await message_queue.receive(lambda m: m.id == "1")
    assert result == message
    assert message_queue.queued_messages_count() == 0


@pytest.mark.asyncio
async def test_receive_non_existing_message(message_queue):
    messages = [Message("2", "World")]
    message_queue.receive_delegate = lambda: asyncio.sleep(0, messages.pop(0) if messages else None)

    result = await message_queue.receive(lambda m: m.id == "2")
    assert isinstance(result, Message)
    assert result.id == "2"
    assert result.content == "World"


@pytest.mark.asyncio
async def test_receive_multiple_messages(message_queue):
    messages = [Message("1", "First"), Message("2", "Second"), Message("3", "Third")]
    for message in messages:
        message_queue._push_back(message)

    result1 = await message_queue.receive(lambda m: m.id == "2")
    result2 = await message_queue.receive(lambda m: m.id == "1")
    result3 = await message_queue.receive(lambda m: m.id == "3")

    assert result1 == messages[1]
    assert result2 == messages[0]
    assert result3 == messages[2]
    assert message_queue.queued_messages_count() == 0


@pytest.mark.asyncio
async def test_receive_end_of_stream(message_queue):
    result = await message_queue.receive(lambda m: True)
    assert result is None


@pytest.mark.asyncio
async def test_receive_with_error(message_queue):
    async def receive_delegate():
        raise Exception("Test error")

    message_queue.receive_delegate = receive_delegate

    with pytest.raises(Exception, match="Test error"):
        await message_queue.receive(lambda m: True)


@pytest.mark.asyncio
async def test_multiple_receivers_same_predicate(message_queue):
    messages = [Message("1", "Shared")]
    message_queue.receive_delegate = lambda: asyncio.sleep(0, messages.pop(0) if messages else None)

    task1 = asyncio.create_task(message_queue.receive(lambda m: m.id == "1"))
    task2 = asyncio.create_task(message_queue.receive(lambda m: m.id == "1"))

    result1, result2 = await asyncio.gather(task1, task2)

    assert result1.content == "Shared"
    assert result2 is None


@pytest.mark.asyncio
async def test_polling_mechanism(message_queue):
    messages = [Message("2", "Second"), Message("1", "First"), Message("3", "Third")]

    async def delayed_receive_delegate():
        await asyncio.sleep(0.1)
        return messages.pop(0) if messages else None

    message_queue.receive_delegate = delayed_receive_delegate

    task1 = asyncio.create_task(message_queue.receive(lambda m: m.id == "1"))
    task2 = asyncio.create_task(message_queue.receive(lambda m: m.id == "2"))
    task3 = asyncio.create_task(message_queue.receive(lambda m: m.id == "3"))

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

    result1 = await message_queue.receive(lambda m: m.id == "1")
    assert result1.content == "First"
    assert not message_queue.is_polling
    assert message_queue.poll_task is None

    result2 = await message_queue.receive(lambda m: m.id == "2")
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
        asyncio.create_task(message_queue.receive(lambda m: m.id == "1")),
        asyncio.create_task(message_queue.receive(lambda m: m.id == "2")),
        asyncio.create_task(message_queue.receive(lambda m: m.id == "3")),
        asyncio.create_task(message_queue.receive(lambda m: m.id == "4")),
    ]

    results = await asyncio.gather(*tasks)

    assert [msg.content if msg else None for msg in results] == ["First", "Second", "Third", None]
    assert not message_queue.is_polling
    assert message_queue.poll_task is None


@pytest.mark.asyncio
async def test_receive_with_complex_predicate(message_queue):
    messages = [
        Message("1", "Apple"),
        Message("2", "Banana"),
        Message("3", "Cherry"),
        Message("4", "Date"),
    ]
    for message in messages:
        message_queue._push_back(message)

    result = await message_queue.receive(lambda m: m.id in ["2", "4"] and len(m.content) > 5)
    assert result.id == "2"
    assert result.content == "Banana"

    result = await message_queue.receive(lambda m: m.content.startswith("C"))
    assert result.id == "3"
    assert result.content == "Cherry"


@pytest.mark.asyncio
async def test_receive_with_always_true_predicate(message_queue):
    messages = [Message("1", "First"), Message("2", "Second")]
    for message in messages:
        message_queue._push_back(message)

    result1 = await message_queue.receive(lambda m: True)
    result2 = await message_queue.receive(lambda m: True)

    assert result1.id == "1"
    assert result2.id == "2"
    assert message_queue.queued_messages_count() == 0


@pytest.mark.asyncio
async def test_receive_with_always_false_predicate(message_queue):
    messages = [Message("1", "First"), Message("2", "Second")]
    message_queue.receive_delegate = lambda: asyncio.sleep(0, messages.pop(0) if messages else None)

    result = await asyncio.wait_for(message_queue.receive(lambda m: False), timeout=0.5)
    assert result is None
    assert message_queue.queued_messages_count() == 2
