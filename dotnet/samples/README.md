# .NET samples for Azure OpenAI /realtime

This folder contains samples that use the `/realtime` API with the OpenAI .NET SDK library and its Azure.AI.OpenAI companion.

| | |
|---|---|
| Last updated for | Azure.AI.OpenAI.2.1.0-beta.1 |

## General patterns

### Client instantiation

`RealtimeConversationClient` is instantiated like any other scenario client in the Azure.AI.OpenAI/OpenAI enviroment: configure a top-level client and then invoke `GetRealtimeConversationClient(string deploymentName)`:

```csharp
AzureOpenAIClient topLevelClient = new(
    new Uri(Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")),
    new ApiKeyCredential(Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY")));
RealtimeConversationClient client = topLevelClient.GetRealtimeConversationClient("my-gpt-4o-realtime-preview-deployment");
```

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

### Sending data

**Audio**:

For simplicity, samples here will often use a "fire and forget" pattern with an audio stream from a file:

```csharp
using Stream audioInputStream = File.OpenRead("..\\audio_hello_world.wav");
_ = session.SendAudioAsync(audioInputStream);
```

This `Stream`-based method will automatically read and chunk data from the stream 

**Text**:

Text input, tool responses, conversation history, and other information are supplied to the session via the `AddItemAsync()` method. The `ConversationItem` type provides various static factory methods to instantiate items including role-based chat messages and function tool outputs, among others. 

**Manual messages**

Only a subset of the full `/realtime` protocol is currently represented; if sending an explicit message is desired, the generic `conversation.SendMessageAsync(data)` allows an arbitrary message to be sent:

```csharp
await conversation.SendMessageAsync(BinaryData.FromString("""
{
  "event": "create_conversation",
  "label": "my_second_conversation"
}
""");
```

### Receiving data

Incoming message receipt is pumped via the `IAsyncEnumerable<ConversationUpdate>` provided by `session.ReceiveUpdatesAsync()`. In addition to being downcastable into derived types that encapsulate command-specific data, each `ConversationUpdate` also exposes a generic `BinaryData` instance via the `GetRawContent()` method, which will provide the direct JSON payload present in the message.

```csharp
await foreach (ConversationUpdate update in conversation.ReceiveUpdatesAsync())
{
    Console.WriteLine(message.GetRawContent().Content.ToString());
    if (update is ConversationSessionStartedUpdate sessionStartedUpdate)
    {
        // ...
    }
}
```

`ConversationUpdate` also exposes a `Kind` property with a enum value that directly maps to an associated WebSocket command `type`.