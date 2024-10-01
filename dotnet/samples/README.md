# .NET samples for Azure OpenAI /realtime

This folder contains samples that use the `/realtime` API via alpha-status forks of the official OpenAI .NET SDK library and its Azure.AI.OpenAI companion. The `OpenAI` and `Azure.AI.OpenAI` NuGet packages contained here are snapped from slightly older versions of the libraries and may not be up-to-date with the latest mainline features -- the primary topic of interest is the addition of `ConversationClient` and the `ConversationOperation` API.

## General patterns

| | |
|---|---|
| Last updated | Azure.AI.OpenAI.2.0.0-alpha-private-realtime-1726172280 |

### Client instantiation

`ConversationClient` is instantiated like any other scenario client in the Azure.AI.OpenAI/OpenAI enviroment: configure a top-level client and then invoke `GetConversationClient()`:

```csharp
AzureOpenAIClient topLevelClient = new(
    new Uri(Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")),
    new ApiKeyCredential(Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY")));
ConversationClient client = topLevelClient.GetConversationClient();
```

### Session setup

> [!NOTE]
> `ConversationOperation` currently always uses the `server_detection` `turn_end_type`. Dedicated support for `client_decision` (push-to-talk and external voice detection scenarios) will come in a future update.

To begin a `/realtime` session, call `StartConversationAsync()`, optionally providing an instance of `ConversationOptions` to perform initial configuration of the session via a `set_inference_config` message. Note that `ConversationOperation` implements `IDisposable` and consider employing the `using` keyword to ensure prompt connection cleanup.

```csharp
ConversationOptions options = new()
{
    SystemMessage = "You are a helpful assistant that always talks like a pirate and has a particular fondness for cute animals.",
};
using ConversationOperation conversation = await client.StartConversationAsync(options);
```

Once created, the `ConversationOperation` represents a bidirectional connection that can simultaneously send and receive WebSocket messages.

### Sending data

**Audio**:

Audio data can be sent one of two ways: providing individual `BinaryData` chunks to `conversation.SendAudioAsync(data)` or by providing a stream to `conversation.SendAudioAsync(stream)`. The `BinaryData` variant allows full control over which messages are sent when and how large the individual messages are; the latter will automatically chunk and and send a `client_turn_finished` message once the stream ends.

For simplicity, samples here will often use a "fire and forget" pattern with an audio stream from a file:

```csharp
using Stream audioInputStream = File.OpenRead("..\\audio_hello_world.wav");
_ = conversation.SendAudioAsync(audioInputStream);
```

Regardless of mechanism, please note that transmitted audio should match the format specified in `ConversationOptions.AudioFormat` -- `Pcm16` by default, which is 24000 KHz, 16-bit, 1-channel PCM (little-endian) with no header.

**Text**:

Text messages are currently supported via `conversation.SendTextAsync()`, which will send a `user`-role `add_item` message with a single piece of `text` content for the input.

**Tool Responses**:

Tool responses are sent using `conversation.SendToolResponseAsync(id, responseFromTool)`. Note that, while tool responses can be sent at any time after receiving a tool call, a manual `client_turn_finished` should be sent *after* receiving a `turn_finished` message confirming that all tool calls for the turn have been sent.

**Control messages**:

For convenience, several methods abstract some of the `/realtime` control messages, including:

- `FinishTurnAsync()` -- sends a `client_turn_finished` message
- `GenerateAsync()` -- sends a `generate` message
- `CommitAudioAsync()` -- sends a `commit_user_audio` message
- `ReconfigureAsync()` -- sends a new `set_inference_config` message

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

Incoming message receipt is pumped via the `IAsyncEnumerable<ConversationMessage>` provided by `conversation.ReceiveMessagesAsync()`. Each `ConversationMessage` encapsulates a `ClientResult`, and the `.GetRawResponse()` method will provide the direct JSON payload present in the message.

```csharp
await foreach (ConversationMessage message in conversation.ReceiveMessagesAsync())
{
    Console.WriteLine(message.GetRawResponse().Content.ToString());
}
```

Within the loop:

`ConversationMessage` has a `Kind` property with an enumeration mapping to known events; this can be used to easily handle specific `/realtime` message types.

```csharp
if (message.Kind == ConversationMessageKind.TurnFinished)
{
    Console.WriteLine($">>> Model turn complete. All done!");
    break;
}
```

`ConversationMessage` also has a number of properties that contain possible data payloads, conditionally populate based on which `Kind` of message is received:

- `Text`, which is `Data` emplaced by `add_content` when `type` is `text`
- `AudioBytes`, which is `Data` emplaced by `add_content` when `type` is `audio`
- `AudioTranscript`, which is the `transcript` from an `input_transcribed` message
- `AudioSampleIndex`, as provided by `vad_speech_started` and `vad_speech_stopped` messages
- `ToolCallId`, `ToolName`, and `ToolArguments`, as appear in `item_added` for `tool_call` items
- `FinishReason`, as appears on `turn_finished`

For ease of use, `ConversationOperation` will also automatically accumulate text and audio received on a turn (single conversation assumed) and populate the full, concatenated data upon receipt of a `turn_finished`:

```csharp
Console.WriteLine($"Full text from turn: {conversation.LastTurnFullResponseText}");
Console.WriteLine($"Full audio from turn: {conversation.LastTurnFullResponseAudio.ToArray().Length} bytes");
```
