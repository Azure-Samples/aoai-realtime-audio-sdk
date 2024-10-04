# OpenAI .NET: /realtime basic console app with live audio input and output

This short console application demonstrates an interactive experience using the `NAudio` library (https://github.com/naudio/NAudio) for input and output from the default microphone and speaker. 

## Usage

1. Set the `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` environment variables to match your `/realtime`-enabled Azure OpenAI resource
  - Alternatively, if your Azure OpenAI Service resource is configured for managed identity, you can set the `AZURE_OPENAI_USE_ENTRA` environment variable to `true` to employ `DefaultAzureCredential` token-based authentication
  - If you'd like to use the non-Azure OpenAI v1 endpoint, don't set `AZURE_OPENAI_ENDPOINT` and use `OPENAI_API_KEY` as the source for authentication, instead
2. `dotnet run` (or build/run from `RealtimeInteractiveConsole.csproj`)

Example output:

```
PS D:\s\dotnet\samples\console> dotnet run
 * Connecting to Azure OpenAI endpoint (AZURE_OPENAI_ENDPOINT): https://my-aoai-resource-eastus2.openai.azure.com/
 * Using API key (AZURE_OPENAI_API_KEY): abc12**
 * Using deployment (AZURE_OPENAI_DEPLOYMENT): my-gpt-4o-realtime-preview-deployment
 <<< Connected: session started
 >>> Listening to microphone input
 >>> (Just tell the app you're done to finish)

 <<< Start of speech detected
 <<< End of speech detected
Sure! >>> USER: Hi, can you tell me a short joke?

 How about a classic one:

Why don't scientists trust atoms?

Because they make up everything! 😄
 <<< Start of speech detected
 <<< End of speech detected

 <<< Finish tool invoked -- ending conversation!
```

## Code explanation/walkthrough

For a more detailed walkthrough of core concepts, please see [the README for the file-based sample](../console-from-file/README.md). This README will focus on the interactive components.

This sample uses two rudimentary multimedia abstractions built atop the `NAudio` library:
- `MicrophoneAudioStream`, which presents `pcm16` (24 KHz, 16-bit mono PCM) audio from the system default capture device as a `Stream`
- `SpeakerOutput`, which provides simple "play" and "clear" abstractions for output of `pcm16` audio to the system default render device

These multimedia abstractions are minimal stand-ins for robust audio handling and are not designed for production use.

The application:
- Configures a client from environment variables and connects a new session
- Configures the session to enable input audio transcription and provide a simplistic "I'm finished" tool, which lets the model decide when the user appears to want to finish a conversation
- Starts playback to the default output device
- Begins processing received commands from the session:
  - Upon the session successfully starting, microphone input begins
  - Upon the start of user speech being detected, any active audio output is aborted and cleared
  - When user audio input transcription is finished, the transcript is printed as feedback
  - Incremental transcript and audio data are immediately printed or rendered to the speaker
  - When an output item finishes, it's checked to see if it invoked the custom "I'm finished" tool -- if that's true, the loop ends
  - If an error is received, it's printed and the loop ends
