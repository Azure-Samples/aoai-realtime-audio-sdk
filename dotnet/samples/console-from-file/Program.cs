// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI;
using OpenAI.RealtimeConversation;
using System.ClientModel;

#pragma warning disable OPENAI002

public class Program
{
    public static async Task Main(string[] args)
    {
        RealtimeConversationClient client = GetConfiguredClient();

        using RealtimeConversationSession session = await client.StartConversationSessionAsync();

        // Session options control connection-wide behavior shared across all conversations,
        // including audio input format and voice activity detection settings.
        ConversationSessionOptions sessionOptions = new()
        {
            Instructions = "You are a cheerful assistant that talks like a pirate. "
                + "Always inform the user when you are about to call a tool. "
                + "Prefer to call tools whenever applicable.",
            Voice = ConversationVoice.Alloy,
            Tools = { CreateSampleWeatherTool() },
            InputAudioFormat = ConversationAudioFormat.G711Alaw,
            OutputAudioFormat = ConversationAudioFormat.Pcm16,
            InputTranscriptionOptions = new()
            {
                Model = "whisper-1",
            },
        };

        await session.ConfigureSessionAsync(sessionOptions);

        // Conversation history or text input are provided by adding messages to the conversation.
        // Adding a message will not automatically begin a response turn.
        await session.AddItemAsync(
            ConversationItem.CreateUserMessage(["I'm trying to decide what to wear on my trip."]));

        string inputAudioPath = FindFile("audio_weather_alaw.wav");
        using Stream inputAudioStream = File.OpenRead(inputAudioPath);
        _ = session.SendAudioAsync(inputAudioStream);

        string outputAudioPath = "output.raw";
        using Stream outputAudioStream = File.OpenWrite(outputAudioPath);

        await foreach (ConversationUpdate update in session.ReceiveUpdatesAsync())
        {
            if (update is ConversationSessionStartedUpdate sessionStartedUpdate)
            {
                Console.WriteLine($"<<< Session started. ID: {sessionStartedUpdate.SessionId}");
                Console.WriteLine();
            }

            if (update is ConversationInputSpeechStartedUpdate speechStartedUpdate)
            {
                Console.WriteLine(
                    $"  -- Voice activity detection started at {speechStartedUpdate.AudioStartMs} ms");
            }

            if (update is ConversationInputSpeechFinishedUpdate speechFinishedUpdate)
            {
                Console.WriteLine(
                    $"  -- Voice activity detection ended at {speechFinishedUpdate.AudioEndMs} ms");
            }

            // Item started updates notify that the model generation process will insert a new item into
            // the conversation and begin streaming its content via content updates.
            if (update is ConversationItemStartedUpdate itemStartedUpdate)
            {
                Console.WriteLine($"  -- Begin streaming of new item");
                if (!string.IsNullOrEmpty(itemStartedUpdate.FunctionName))
                {
                    Console.Write($"    {itemStartedUpdate.FunctionName}: ");
                }
            }

            // Audio transcript delta updates contain the incremental text matching the generated
            // output audio.
            if (update is ConversationOutputTranscriptionDeltaUpdate outputTranscriptDeltaUpdate)
            {
                Console.Write(outputTranscriptDeltaUpdate.Delta);
            }

            // Audio delta updates contain the incremental binary audio data of the generated output
            // audio, matching the output audio format configured for the session.
            if (update is ConversationAudioDeltaUpdate audioDeltaUpdate)
            {
                outputAudioStream.Write(audioDeltaUpdate.Delta?.ToArray() ?? []);
            }

            if (update is ConversationFunctionCallArgumentsDeltaUpdate argumentsDeltaUpdate)
            {
                Console.Write(argumentsDeltaUpdate.Delta);
            }

            // Item finished updates arrive when all streamed data for an item has arrived and the
            // accumulated results are available. In the case of function calls, this is the point
            // where all arguments are expected to be present.
            if (update is ConversationItemFinishedUpdate itemFinishedUpdate)
            {
                Console.WriteLine();
                Console.WriteLine($"  -- Item streaming finished, response_id={itemFinishedUpdate.ResponseId}");

                if (itemFinishedUpdate.FunctionCallId is not null)
                {
                    Console.WriteLine($"    + Responding to tool invoked by item: {itemFinishedUpdate.FunctionName}");
                    ConversationItem functionOutputItem = ConversationItem.CreateFunctionCallOutput(
                        callId: itemFinishedUpdate.FunctionCallId,
                        output: "70 degrees Fahrenheit and sunny");
                    await session.AddItemAsync(functionOutputItem);
                }
                else if (itemFinishedUpdate.MessageContentParts?.Count > 0)
                {
                    Console.Write($"    + [{itemFinishedUpdate.MessageRole}]: ");
                    foreach (ConversationContentPart contentPart in itemFinishedUpdate.MessageContentParts)
                    {
                        Console.Write(contentPart.AudioTranscriptValue);
                    }
                    Console.WriteLine();
                }
            }

            if (update is ConversationInputTranscriptionFinishedUpdate transcriptionCompletedUpdate)
            {
                Console.WriteLine();
                Console.WriteLine($"  -- User audio transcript: {transcriptionCompletedUpdate.Transcript}");
                Console.WriteLine();
            }

            if (update is ConversationResponseFinishedUpdate turnFinishedUpdate)
            {
                Console.WriteLine($"  -- Model turn generation finished. Status: {turnFinishedUpdate.Status}");

                // Here, if we processed tool calls in the course of the model turn, we finish the
                // client turn to resume model generation. The next model turn will reflect the tool
                // responses that were already provided.
                if (turnFinishedUpdate.CreatedItems.Any(item => item.FunctionName?.Length > 0))
                {
                    Console.WriteLine($"  -- Ending client turn for pending tool responses");
                    await session.StartResponseTurnAsync();
                }
                else
                {
                    break;
                }
            }

            if (update is ConversationErrorUpdate errorUpdate)
            {
                Console.WriteLine();
                Console.WriteLine($"ERROR: {errorUpdate.ErrorMessage}");
                break;
            }
        }

        Console.WriteLine($"Raw output audio written to {outputAudioPath}: {outputAudioStream.Length} bytes");
        Console.WriteLine();
    }

    private static RealtimeConversationClient GetConfiguredClient()
    {
        string? aoaiEndpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT");
        string? aoaiUseEntra = Environment.GetEnvironmentVariable("AZURE_OPENAI_USE_ENTRA");
        string? aoaiDeployment = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT");
        string? aoaiApiKey = Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY");
        string? oaiApiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY");

        if (aoaiEndpoint is not null && bool.TryParse(aoaiUseEntra, out bool useEntra) && useEntra)
        {
            return GetConfiguredClientForAzureOpenAIWithEntra(aoaiEndpoint, aoaiDeployment);
        }
        else if (aoaiEndpoint is not null && aoaiApiKey is not null)
        {
            return GetConfiguredClientForAzureOpenAIWithKey(aoaiEndpoint, aoaiDeployment, aoaiApiKey);
        }
        else if (aoaiEndpoint is not null)
        {
            throw new InvalidOperationException(
                $"AZURE_OPENAI_ENDPOINT configured without AZURE_OPENAI_USE_ENTRA=true or AZURE_OPENAI_API_KEY.");
        }
        else if (oaiApiKey is not null)
        {
            return GetConfiguredClientForOpenAIWithKey(oaiApiKey);
        }
        else
        {
            throw new InvalidOperationException(
                $"No environment configuration present. Please provide one of:\n"
                    + " - AZURE_OPENAI_ENDPOINT with AZURE_OPENAI_USE_ENTRA=true or AZURE_OPENAI_API_KEY\n"
                    + " - OPENAI_API_KEY");
        }
    }

    private static RealtimeConversationClient GetConfiguredClientForAzureOpenAIWithEntra(
        string aoaiEndpoint,
        string? aoaiDeployment)
    {
        Console.WriteLine($" * Connecting to Azure OpenAI endpoint (AZURE_OPENAI_ENDPOINT): {aoaiEndpoint}");
        Console.WriteLine($" * Using Entra token-based authentication (AZURE_OPENAI_USE_ENTRA)");
        Console.WriteLine(string.IsNullOrEmpty(aoaiDeployment)
            ? $" * Using no deployment (AZURE_OPENAI_DEPLOYMENT)"
            : $" * Using deployment (AZURE_OPENAI_DEPLOYMENT): {aoaiDeployment}");

        AzureOpenAIClient aoaiClient = new(new Uri(aoaiEndpoint), new DefaultAzureCredential());
        return aoaiClient.GetRealtimeConversationClient(aoaiDeployment);
    }

    private static RealtimeConversationClient GetConfiguredClientForAzureOpenAIWithKey(
        string aoaiEndpoint,
        string? aoaiDeployment,
        string aoaiApiKey)
    {
        Console.WriteLine($" * Connecting to Azure OpenAI endpoint (AZURE_OPENAI_ENDPOINT): {aoaiEndpoint}");
        Console.WriteLine($" * Using API key (AZURE_OPENAI_API_KEY): {aoaiApiKey[..5]}**");
        Console.WriteLine(string.IsNullOrEmpty(aoaiDeployment)
            ? $" * Using no deployment (AZURE_OPENAI_DEPLOYMENT)"
            : $" * Using deployment (AZURE_OPENAI_DEPLOYMENT): {aoaiDeployment}");

        AzureOpenAIClient aoaiClient = new(new Uri(aoaiEndpoint), new ApiKeyCredential(aoaiApiKey));
        return aoaiClient.GetRealtimeConversationClient(aoaiDeployment);
    }

    private static RealtimeConversationClient GetConfiguredClientForOpenAIWithKey(string oaiApiKey)
    {
        string oaiEndpoint = "https://api.openai.com/v1";
        Console.WriteLine($" * Connecting to OpenAI endpoint (OPENAI_ENDPOINT): {oaiEndpoint}");
        Console.WriteLine($" * Using API key (OPENAI_API_KEY): {oaiApiKey[..5]}**");

        OpenAIClient aoaiClient = new(new ApiKeyCredential(oaiApiKey));
        return aoaiClient.GetRealtimeConversationClient("gpt-4o-realtime-preview-2024-10-01");
    }

    private static ConversationFunctionTool CreateSampleWeatherTool()
    {
        return new ConversationFunctionTool()
        {
            Name = "get_weather_for_location",
            Description = "gets the weather for a location",
            Parameters = BinaryData.FromString("""
            {
              "type": "object",
              "properties": {
                "location": {
                  "type": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "type": "string",
                  "enum": ["c","f"]
                }
              },
              "required": ["location","unit"]
            }
            """)
        };
    }

    private static string FindFile(string fileName)
    {
        for (string currentDirectory = Directory.GetCurrentDirectory();
             currentDirectory != null && currentDirectory != Path.GetPathRoot(currentDirectory);
             currentDirectory = Directory.GetParent(currentDirectory)?.FullName!)
        {
            string filePath = Path.Combine(currentDirectory, fileName);
            if (File.Exists(filePath))
            {
                return filePath;
            }
        }

        throw new FileNotFoundException($"File '{fileName}' not found.");
    }
}
