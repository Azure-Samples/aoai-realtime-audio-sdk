# Realtime Backend FastAPI Sample

This FastAPI application serves as a middle-tier service to mediate connections with the Azure OpenAI or OpenAI Realtime API. It introduces a simplified protocol for backend communication, covering only the necessary functionalities and allowing easy extensions.

## Overview

The service establishes a WebSocket server that communicates with clients using a custom protocol. It translates client messages into the appropriate format for the backend API (Azure OpenAI or OpenAI Realtime API) and handles responses, forwarding them back to the client.

## Features

- **Simplified Protocol**: Uses a custom, lightweight communication protocol.
- **Backend Support**: Works with both Azure OpenAI and OpenAI Realtime APIs.
- **Extendable**: Easily extend the protocol to cover additional functionalities.
- **Secure Authentication**: For Azure, utilizes token credentials through `DefaultAzureCredential`.
- **Async Implementation**: Leverages FastAPI's async capabilities for efficient WebSocket handling.
- **Type Safety**: Utilizes Python type hints throughout the codebase.

## Environment Variables

Set the following environment variables in a `.env` file at the root of the project:

### Common Variables

- `BACKEND`: Specify the backend to use (`azure` or `openai`).
- `PORT` (optional): Port number for the server (default is `8080`).

### Using Azure OpenAI Backend

- `AZURE_OPENAI_ENDPOINT`: Your Azure OpenAI endpoint URL.
- `AZURE_OPENAI_DEPLOYMENT`: The name of your Azure OpenAI deployment.

Authentication is handled via `DefaultAzureCredential`, supporting environment-based credentials, managed identities, or Azure CLI authentication.

### Using OpenAI Realtime API Backend

- `OPENAI_API_KEY`: Your OpenAI API key.
- `OPENAI_MODEL`: The model to use (e.g., `gpt-3.5-turbo`).

## Setup and Run

1. **Install Poetry** (if not already installed)

    ```bash
    curl -sSL https://install.python-poetry.org | python3 -
    ```

2. **Install Dependencies**

    ```bash
    poetry install
    ```

3. **Start the Server**

    ```bash
    poetry run uvicorn rt_server.main:app --reload --port 8080
    ```

The server listens on `http://localhost:<PORT>` and accepts WebSocket connections at the `/realtime` path.

## Development Setup

This project uses several development tools that are automatically installed with Poetry:

- **Black**: Code formatting
- **isort**: Import sorting
- **flake8**: Code linting
- **mypy**: Static type checking

You can run these tools using Poetry:

```bash
poetry run black rt_server
poetry run isort rt_server
poetry run flake8 rt_server
poetry run mypy rt_server
```

## Custom Protocol

The application defines its own protocol for client-server communication:

- **Control Messages**: Manage connection status and actions (e.g., connected, speech_started, text_done).
- **User Messages**: Send user text inputs (user_message).
- **Transcriptions**: Receive transcribed text from audio inputs (transcription).
- **Text Deltas**: Stream partial text responses (text_delta).

This protocol focuses on essential features and can be extended as needed.

## Type Definitions

The protocol messages are defined using Python's typing system:

```python
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
```

## Notes

- Ensure that the required environment variables are set correctly for your chosen backend.
- For Azure backend, authentication relies on DefaultAzureCredential, so configure your environment for token-based authentication.
- Logging is configured using Loguru and can be adjusted through its configuration.
- The server implements CORS middleware with permissive settings for development. Adjust these settings for production use.