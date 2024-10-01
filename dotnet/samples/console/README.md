# OpenAI .NET: /realtime basic console app

This short application demonstrates a simple two-turn use of the `/realtime` endpoint, applying audio input from a file and a single call to a function tool.

## Usage

1. Set the `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` environment variables to match your `/realtime`-enabled Azure OpenAI resource
  - Alternatively, if your Azure OpenAI Service resource is configured for managed identity, you can modify the `useEntraAuthenticationForAzure` value in the application to use `DefaultAzureCredential`
2. `dotnet run` (or build/run from `RealtimeConsoleApp.csproj`)

Example output:

```
PS D:\s\dotnet\samples\console> dotnet run
Connecting using Azure resource URI: https://my-aoai-resource.openai.azure.com
<<< Session started. ID: sess_ABBdREQ0NWCCIV00rPAwP

  -- Voice activity detection started at 928 ms
  -- Voice activity detection ended at 3040 ms
  -- Begin streaming of new item
Ahoy! Let's see what the weather be like in San Francisco. I'll find that out for ye right now! *yo-ho-ho* Calling the weather service for ye!
  -- Item finished, response_id=resp_ABBdS1xYc8TZWsCwbUYwU
    + [assistant]: Ahoy! Let's see what the weather be like in San Francisco. I'll find that out for ye right now! *yo-ho-ho* Calling the weather service for ye!
  -- Begin streaming of new item
{"location":"San Francisco, CA","unit":"f"}
  -- Item finished, response_id=resp_ABBdS1xYc8TZWsCwbUYwU
    + Tool invoked by item: get_weather_for_location
  -- Model turn generation finished. Status: completed
  -- Ending client turn for pending tool responses
  -- Begin streaming of new item
Arrr! The weather in San Francisco be a balmy 70 degrees Fahrenheit and sunny! A perfect day for sailing the seas or wandering the shore! Ye might want to dress light, but keep a jacket close by, as the sea breeze can be cool.
  -- Item finished, response_id=resp_ABBdVXNGDK6PQhzWH3Qnr
    + [assistant]: Arrr! The weather in San Francisco be a balmy 70 degrees Fahrenheit and sunny! A perfect day for sailing the seas or wandering the shore! Ye might want to dress light, but keep a jacket close by, as the sea breeze can be cool.
  -- Model turn generation finished. Status: completed
Raw output audio written to output.raw: 1339200 bytes
```

## Code explanation/walkthrough

Support for the `/realtime` API is provisionally provided via a new `RealtimeConversationClient` type, peer to other scenario clients like `ChatClient`. This is currently furnished via *forked versions* of the `OpenAI` and `Azure.AI.OpenAI` packages, with NuGet packages in the parent folder.

In accordance with its prerelease status, a new `OPENAI002` experimental ID is added and must be suppressed, as in the example via `#pragma warning disable OPENAI002`, to acknowledge the subject-to-change nature of the surface.

Client configuration is achieved like other OpenAI .NET clients: instantiating a top-level `OpenAIClient` (`AzureOpenAIClient` when using Azure OpenAI) and then calling `.GetRealtimeConversationClient()` to retrieve the scenario client for `/realtime`. The example uses the standard `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` environment variables as the source for connection details and can also be configured to use token-based Entra authentication (against Azure OpenAI Service resources with managed identity enabled) via the `Azure.Identity` `DefaultAzureCredential` type.

Conceptually:
- Connecting to `/realtime` establishes **a conversation session**.
- Conversation sessions have **one or more distinct conversations** that share access to a user audio input buffer and (if enabled) a voice activity detection component
- Sessions **create a `"default"` conversation** automatically -- additional conversations cannot yet be created or managed

A `/realtime` connection session is managed via the `RealtimeConversationSession` type, an `IDisposable` class created by calling `ConversationClient.StartConversationSessionAsync()`. `ConversationSessionOptions` is the type that encapsulates additional, non-required configuration for the connection-wide session, including input and output audio formats, turn end detection behavior, instructions, and tools. After a session is created with `StartConversationSessionAsync()`, `session.ConfigureSessionAsync(sessionOptions)` can be used to configure these details.

Calling `AddItemAsync()` on `RealtimeConversationSession` allows adding non-audio (e.g. text) content as well as establishing conversation history or few-shot examples for model inference to use. As demonstrated further in the sample, this method is also the mechanism used to provide responses to tool calls.

`RealtimeConversationSession`'s `SendAudioAsync(Stream)` method will automatically chunk and transmit audio data from a provided stream. Alternatively, the `SendAudioAsync(BinaryData)` method allows individual audio message transmissions. Because commands are sent and received in parallel, it's not necessary to `await` or otherwise block on audio transmission; the sample application goes directly into the message receipt processing.

`RealtimeConversationSession`'s `ReceiveUpdatesAsync()` method provides an `IAsyncEnumerable` of `ConversationUpdate` instances, each representing a single received command from the `/realtime` endpoint. The `ConversationUpdateKind` enumeration on the `UpdateKind` property of the `ConversationUpdate` type maps directly to the corresponding `type` in the wire protocol; these, in turn, also have a down-cast, concrete derived type of the abstract `ConversationUpdate`, e.g. `ConversationResponseStartedUpdate` for `response.created` and `ConversationItemFinishedUpdate` for `conversation.item.done`. These down-cast types can be cast via `as` or `is` to gain access to command-specific data, e.g. `(update as ConversationAudioTranscriptDeltaUpdate).Delta`.

## Advanced use

The strongly typed surface for `RealtimeConversationSession` is under active development and may not adequately expose all details of the wire protocol, particularly as commands continue to evolve. It supports passthrough use of request messages via `SendCommandAsync(BinaryData)` (allowing arbitrary JSON to be sent) and the raw JSON of each message may be retrieved by serializing each `ConversationUpdate` instance via `System.ClientModel.Primitives.ModelReaderWriter.Write(update)`. In this manner, `RealtimeConversationSession` may be treated as a low-level WebSocket message client for `/realtime`.

For direct observability of WebSocket traffic as it's sent and received, `RealtimeConversationClient` provides `OnSendingCommand` and `OnReceivingCommand` event handlers.