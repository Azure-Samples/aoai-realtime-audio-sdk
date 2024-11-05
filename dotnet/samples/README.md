# .NET samples for Azure OpenAI /realtime

This folder contains samples that use the `/realtime` API with the OpenAI .NET SDK library and its Azure.AI.OpenAI companion.

| | |
|---|---|
| Last updated for | Azure.AI.OpenAI.2.1.0-beta.2 |

## General patterns

### Client instantiation

`RealtimeConversationClient` is instantiated like any other scenario client in the Azure.AI.OpenAI/OpenAI enviroment: configure a top-level client and then invoke `GetRealtimeConversationClient(string deploymentName)`:

```csharp
AzureOpenAIClient topLevelClient = new(
    new Uri(Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")),
    new ApiKeyCredential(Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY")));
RealtimeConversationClient client = topLevelClient.GetRealtimeConversationClient("my-gpt-4o-realtime-preview-deployment");
```

If connecting to OpenAI's `/v1/realtime` endpoint, substitute use of `OpenAIClient` or construct a `RealtimeConversationClient` directly. All other usage is identical.

### Session setup

To begin a `/realtime` session, call `StartConversationSessionAsync()` on a configured `RealtimeConversationClient` instance. Note that `RealtimeConversationSession` implements `IDisposable` and consider employing the `using` keyword to ensure prompt connection cleanup.

```csharp
using RealtimeConversationSession conversation = await client.StartConversationSessionAsync();
```

Once created, the `RealtimeConversationSession` represents a bidirectional connection that can simultaneously send and receive WebSocket messages.

### Configuring the session

The parameters to the `session.update` `/realtime` WebSocket command are abstracted by the `ConversationSessionOptions` class, which in turn can be provided to the `ConfigureSessionAsync()` method on `RealtimeConversationSession`. Configuring the session allows specifying instructions, audio input and output formats, tool definitions, and other customizations to the default settings that arrive on the initial `session.created` event.

```csharp
ConversationSessionOptions options = new()
{
    Instructions = "You are a friendly assistant.",
    InputTranscriptionOptions = new()
    {
        Model = "whisper-1",
    },
};
await session.ConfigureSessionAsync(options);
```

**Input audio transcription** (an approximation of what was said in user-provided input audio) is not enabled by default; to enable it, populate the `InputTranscriptionOptions` property as above.

By default, **turn detection** will use server voice activity detection (VAD). To disable this or customize the behavior of server VAD, provide a value to the `TurnDetectionOptions` property -- `ConversationTurnDetectionOptions.CreateDisabledTurnDetectionOptions()` will provide an instance that turns VAD off, enabling push-to-talk or a custom client-side VAD implementation to be used.

### Sending data

**Audio**:

For simplicity, samples here will often use a "fire and forget" pattern with an audio stream from a file:

```csharp
using Stream audioInputStream = File.OpenRead("..\\audio_hello_world.wav");
_ = session.SendInputAudioAsync(audioInputStream);
```

This `Stream`-based method will automatically read and chunk data from the stream. If finer granularity or otherwise push-style control is needed, the `SendInputAudioAsync(BinaryData)` method signature can be used to send chunks individually.

**Text and other non-audio data**:

Text input, tool responses, conversation history, and other information are supplied to the session via the `AddItemAsync()` method. The `ConversationItem` type provides various static factory methods to instantiate items including role-based chat messages and function tool outputs, among others. For example:

- `ConversationItem.CreateUserMessage()` creates a user-role conversation item reflecting one or more content parts that can feature text input.
- `ConversationItem.CreateFunctionCallOutput()` creates a conversation item that responds to a received function call.
- `ConversationItem.CreateAssistantMessage()` and `ConversationItem.CreateFunctionCall()` facilitate the creation of items that form or restore a conversation history.

```csharp
await session.AddItemAsync(
    ConversationItem.CreateUserMessage(["Hello, assistant! Can you help me today?"]));
``` 

**Manual messages**

If sending an explicit message is desired, the generic `session.SendCommandAsync(BinaryData)` allows an arbitrary message to be sent:

```csharp
await session.SendCommandAsync(BinaryData.FromString("""
{
  "event": "session.update",
  "session": {
  }
}
""");
```

### Receiving data

Incoming message receipt is pumped via the `IAsyncEnumerable<ConversationUpdate>` provided by `session.ReceiveUpdatesAsync()`. Each incoming `ConversationUpdate` has an enumerated `Kind` value that maps directly to a WebSocket server event type (like `session.started`) and, depending on the type, each update will be downcastable to a derived type of `ConversationUpdate` with additional data specific to the event.

As an example: upon connection, the session will receive a `session.updated` server event that's received as a `ConversationSessionStartedUpdate` via `ReceiveUpdatesAsync()`. That will expose a `SessionStarted` enumeration value on its `Kind` property and be accessible via downcast:

```csharp
await foreach (ConversationUpdate update in conversation.ReceiveUpdatesAsync())
{
    // update.Kind == ConversationUpdateKind.SessionStarted (session.started)
    if (update is ConversationSessionStartedUpdate sessionStartedUpdate)
    {
        Console.WriteLine($"New session started, id = {sessionStartedUpdate.SessionId}");
    }
}
```

**Session-wide updates**

The following all provide information pertaining the session itself or to the shared information persisted across responses in the session:

| Derived type | Kind value(s) | WebSocket event | Description |
|---|---|---|---|
| `ConversationSessionStartedUpdate` | `SessionStarted` | `session.created` | Raised upon successful connection. Provides *default* session configuration values that do not reflect any changes made via `ConfigureSessionAsync()`. |
| `ConversationSessionConfiguredUpdate` | `SessionConfigured` | `session.updated` | Raised upon receipt of a `session.update` command via `ConfigureSessionAsync()`. Provides *updated* session configured values reflecting the requested changes. Response-level changes will take effect beginning with the next response. |
| `ConversationInputSpeechStartedUpdate` | `InputSpeechStarted` | `input_audio_buffer.speech_started` | With server-side voice activity detection enabled (also default), this is raised when the audio provided via `SendInputAudioAsync()` has speech detected. |
| `ConversationInputSpeechFinishedUpdate` | `InputSpeechFinished` | `input_audio_buffer.speech_stopped` | With server-side voice activity detection enabled (also default), this is raised when the audio provided via `SendInputAudioAsync()` ceases to detect active speech. |
| `ConversationInputAudioCommittedUpdate` | `InputAudioCommitted` | `input_audio_buffer.committed` | Raised when input audio is committed as conversation input. This will occur automatically when server-side voice activity detection is enabled, upon end of speech detection. Without server VAD, an explicit call to `CommitInputAudioAsync()` is required. |
| `ConversationInputAudioClearedUpdate` | `InputAudioCleared` | `input_audio_buffer.cleared` | Raised when input audio is cleared via a call to `ClearInputAudioAsync()`. |
| `ConversationRateLimitsUpdate` | `RateLimitsUpdated` | `rate_limits.updated` | Periodically raised to reflect the latest rate limit information for tokens and requests. |

**Response-level updates**

| Derived type | Kind value(s) | WebSocket event | Description |
|---|---|---|---|
| `ConversationResponseStartedUpdate` | `ResponseStarted` | `response.created` | Raised when the model begins generating a new response, snapshotting current input state. This occurs automatically with end of speech when server voice activity detection is enabled and can be requested manually via `StartResponseAsync()`. |
| `ConversationResponseFinishedUpdate` | `ResponseFinished` | `response.done` | Raised when all response data is complete. |

**Item-level updates**

| Derived type | Kind value(s) | WebSocket event | Description |
|---|---|---|---|
| `ConversationItemCreatedUpdate` | `ItemCreated` | `conversation.item.created` | |
| `ConversationItemDeletedUpdate` | `ItemDeleted` | `conversation.item.deleted` | |
| `ConversationItemTruncatedUpdate` | `ItemTruncated` | `conversation.item.truncated` | |
| `ConversationInputTranscriptionFinishedUpdate` | `InputTranscriptionFinished` | `conversation.item.input_audio_transcription.completed` | |
| `ConversationInputTranscriptionFailedUpdate` | `InputTranscriptionFailed` | `conversation.item.input_audio_transcription.failed` | |

**Item streaming updates**

| Derived type | Kind value(s) | WebSocket event | Description |
|---|---|---|---|
| `ConversationItemStreamingStartedUpdate` | `ItemStreamingStarted` | `response.output_item.added` | Received when a new output item is opened for the response and begins receiving streamed information. This will be followed by some number of `ConversationItemStreamingPartDeltaUpdate` instances providing the streamed data before a `ConversationItemStreamingFinishedUpdate` signals the end of all streamed incremental information. |
| `ConversationItemStreamingFinishedUpdate` | `ItemStreamingFinished` | `response.output_item.done` | Received when a new output item has finished receiving all streamed information. Includes the accumulated data of the delta updates. |
| `ConversationItemStreamingPartDeltaUpdate` | * | * | This update is received when incremental streamed data is available for an in-progress response output item. It combines several server event types, with the specific payload inferrable from which properties are populated or the value of `Kind` on the update. Some streamed conversation items can consistent of multiple content parts; in this situation, the `ContentPartIndex` will distinguish between inner content parts and individual `ConversationItemStreamingPartFinishedUpdates` instances will be raised per content part. |
| | `ItemContentPartStarted` | `response.content_part.added` | |
| | `ItemStreamingPartAudioDelta` | `response.audio.delta` | |
| | `ItemStreamingPartAudioTranscriptionDelta` | `response.audio_transcript.delta` | |
| | `ItemStreamingPartTextDelta` | `response.text.delta` | |
| | `ItemStreamingFunctionCallArgumentsDelta` | `response.function_call_arguments.delta` | |
| `ConversationItemStreamingPartFinishedUpdate` | * | * | Received when an individual component of a streamed conversation item, such as a content part, has finished receiving all streamed data. In many circumstances, using the superset of information available in `ConversationItemStreamingFinishedUpdate` is adequate; this update simply provides further granularities in instances where multiple item components are streamed. |
| | `ItemStreamingFunctionCallArgumentsFinished` | `response.function_call_arguments.done` | |
| | `ItemContentPartFinished` | `response.content_part.done` | |

**Raw/protocol update usage**

In addition to being downcastable into derived types that encapsulate command-specific data, each `ConversationUpdate` also exposes a generic `BinaryData` instance via the `GetRawContent()` method, which will provide the direct JSON payload present in the message.

```csharp
await foreach (ConversationUpdate update in conversation.ReceiveUpdatesAsync())
{
    Console.WriteLine(message.GetRawContent().Content.ToString());
}
```

Together with the use of `SendCommandAsync(BinaryData)`, 