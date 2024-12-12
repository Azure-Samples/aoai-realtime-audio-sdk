import asyncio
import websockets

async def test_websocket():
    uri = "ws://localhost:8080/realtime"
    async with websockets.connect(uri) as websocket:
        print("WebSocket connection established")
        await websocket.send("Hello, server!")
        response = await websocket.recv()
        print(f"Message from server: {response}")

asyncio.get_event_loop().run_until_complete(test_websocket())