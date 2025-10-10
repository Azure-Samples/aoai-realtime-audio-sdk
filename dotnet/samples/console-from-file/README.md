# OpenAI .NET: /realtime basic console app (file-based)

This short application demonstrates a simple two-turn use of the `/realtime` endpoint, applying audio input from a file and a single call to a function tool.

## Usage

1. Set the `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` environment variables to match your `/realtime`-enabled Azure OpenAI resource
  - Alternatively, if your Azure OpenAI Service resource is configured for managed identity, you can set the `AZURE_OPENAI_USE_ENTRA` environment variable to `true` to employ `DefaultAzureCredential` token-based authentication
  - If you'd like to use the non-Azure OpenAI v1 endpoint, don't set `AZURE_OPENAI_ENDPOINT` and use `OPENAI_API_KEY` as the source for authentication, instead
2. `dotnet run` (or build/run from `RealtimeConsoleApp.csproj`)

Example output:

```
PS D:\s\dotnet\samples\console> dotnet run
 * Connecting to Azure OpenAI endpoint (AZURE_OPENAI_ENDPOINT): https://my-aoai-resource-eastus2.openai.azure.com/
 * Using API key (AZURE_OPENAI_API_KEY): abc12**
 * Using deployment (AZURE_OPENAI_DEPLOYMENT): my-gpt-4o-realtime-preview-deployment
<<< Session started. ID: sess_AERevEfOC3pSdIdCcJRKo

  -- Voice activity detection started at 928 ms
  -- Voice activity detection ended at 3040 ms
  -- Begin streaming of new item
Arrr, let me check the
  -- User audio transcript: What's the weather like in San Francisco right now?


 weather in San Francisco for ye!
  -- Item streaming finished, response_id=resp_AERewVPR59Ab5YSQteWaj
    + [assistant]: Arrr, let me check the weather in San Francisco for ye!
  -- Begin streaming of new item
    get_weather_for_location: {"location":"San Francisco, CA","unit":"f"}
  -- Item streaming finished, response_id=resp_AERewVPR59Ab5YSQteWaj
    + Responding to tool invoked by item: get_weather_for_location
  -- Model turn generation finished. Status: completed
  -- Ending client turn for pending tool responses
  -- Begin streaming of new item
The weather in San Francisco be a balmy 70 degrees Fahrenheit and sunny. A fine day to be out and about! Ye might want to wear somethin' light and comfortable, but be prepared for a bit of a chill if the wind picks up near the bay. Arrr ye needin' anything else?
  -- Item streaming finished, response_id=resp_AERexJpcwMmmTBRvINQOY
    + [assistant]: The weather in San Francisco be a balmy 70 degrees Fahrenheit and sunny. A fine day to be out and about! Ye might want to wear somethin' light and comfortable, but be prepared for a bit of a chill if the wind picks up near the bay. Arrr ye needin' anything else?
  -- Model turn generation finished. Status: completed
Raw output audio written to output.raw: 2652000 bytes
```

## Code explanation/walkthrough

Support for the `/realtime` API is provisionally provided via a new `RealtimeConversationClient` type, peer to other scenario clients like `ChatClient`. This is currently furnished via *forked versions* of the `OpenAI` and `Azure.AI.OpenAI` packages, with NuGet packages in the parent folder.

In accordance with its prerelease status, a new `OPENAI002` experimental ID is added and must be suppressed, as in the example via `#pragma warning disable OPENAI002`, to acknowledge the subject-to-change nature of the surface.

Client configuration is achieved like other OpenAI .NET clients: instantiating a top-level `OpenAIClient` (`AzureOpenAIClient` when using Azure OpenAI) and then calling `.GetRealtimeConversationClient()` to retrieve the scenario client for `/realtime`. The example uses the standard `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` environment variables as the source for connection details and can also be configured to use token-based Entra authentication (against Azure OpenAI Service resources with managed identity enabled) via the `Azure.Identity` `DefaultAzureCredential` type.

A `/realtime` connection session is managed via the `RealtimeConversationSession` type, an `IDisposable` class created by calling `ConversationClient.StartConversationSessionAsync()`. `ConversationSessionOptions` is the type that encapsulates additional, non-required configuration for the connection-wide session, including input and output audio formats, turn end detection behavior, instructions, and tools. After a session is created with `StartConversationSessionAsync()`, `session.ConfigureSessionAsync(sessionOptions)` can be used to configure these details.

Calling `AddItemAsync()` on `RealtimeConversationSession` allows adding non-audio (e.g. text) content as well as establishing conversation history or few-shot examples for model inference to use. As demonstrated further in the sample, this method is also the mechanism used to provide responses to tool calls.

`RealtimeConversationSession`'s `SendInputAudioAsync(Stream)` method will automatically chunk and transmit audio data from a provided stream. Alternatively, the `SendInputAudioAsync(BinaryData)` method allows individual audio message transmissions. Because commands are sent and received in parallel, it's not necessary to `await` or otherwise block on audio transmission; the sample application goes directly into the message receipt processing.

`RealtimeConversationSession`'s `ReceiveUpdatesAsync()` method provides an `IAsyncEnumerable` of `ConversationUpdate` instances, each representing a single received command from the `/realtime` endpoint. The `ConversationUpdateKind` enumeration on the `Kind` property of the `ConversationUpdate` type maps directly to the corresponding `type` in the wire protocol; these, in turn, also have a down-cast, concrete derived type of the abstract `ConversationUpdate`, e.g. `ConversationResponseStartedUpdate` for `response.created`.

## Advanced use

The strongly typed surface for `RealtimeConversationSession` is under active development and may not yet accurately reflect every detail of the wire protocol. It supports passthrough use of request messages via `SendCommandAsync(BinaryData)` (allowing arbitrary JSON to be sent) and the raw JSON of each message may be retrieved by serializing each `ConversationUpdate` instance via `ConversationUpdate.GetRawContent()` or `System.ClientModel.Primitives.ModelReaderWriter.Write(update)`. In this manner, `RealtimeConversationSession` may be treated as a low-level WebSocket message client for `/realtime`.

For direct observability of WebSocket traffic as it's sent and received, `RealtimeConversationClient` provides `OnSendingCommand` and `OnReceivingCommand` event handlers.