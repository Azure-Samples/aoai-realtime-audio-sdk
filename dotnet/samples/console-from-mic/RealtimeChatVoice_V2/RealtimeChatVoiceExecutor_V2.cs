using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI;
using OpenAI.RealtimeConversation;
using System.ClientModel;

#pragma warning disable OPENAI002

public static class RealtimeChatVoiceExecutor_V2
{
    public static async Task Execute()
    {
        RealtimeConversationClient client = RealtimeClientProvider.GetConfiguredClient();
        using RealtimeConversationSession session = await client.StartConversationSessionAsync();

        ConversationFunctionTool finishConversationTool = ConfigureFinishTool();
        await ConfigureSessionAsync(session, finishConversationTool);

        SpeakerOutput speakerOutput = new();

        await ProcessSessionUpdatesAsync(session, finishConversationTool, speakerOutput);
    }

    private static async Task ConfigureSessionAsync(RealtimeConversationSession session, ConversationFunctionTool finishConversationTool)
    {
        await session.ConfigureSessionAsync(new ConversationSessionOptions()
        {
            Tools = { finishConversationTool },
            InputTranscriptionOptions = new()
            {
                Model = Wellknown.WhisperModel,
            },
        });
    }

    private static ConversationFunctionTool ConfigureFinishTool()
    {
        return new ConversationFunctionTool()
        {
            Name = Wellknown.FinishConversationToolName,
            Description = "Invoked when the user says goodbye, expresses being finished, or otherwise seems to want to stop the interaction.",
            Parameters = BinaryData.FromString("{}")
        };
    }

    private static async Task ProcessSessionUpdatesAsync(RealtimeConversationSession session, ConversationFunctionTool finishConversationTool, SpeakerOutput speakerOutput)
    {
        await foreach (ConversationUpdate update in session.ReceiveUpdatesAsync())
        {
            switch (update)
            {
                case ConversationSessionStartedUpdate:
                    HandleSessionStarted(session);
                    break;

                case ConversationInputSpeechStartedUpdate:
                    HandleSpeechStarted(speakerOutput);
                    break;

                case ConversationInputSpeechFinishedUpdate:
                    HandleSpeechFinished();
                    break;

                case ConversationInputTranscriptionFinishedUpdate transcriptionFinishedUpdate:
                    HandleInputTranscription(transcriptionFinishedUpdate);
                    break;

                case ConversationAudioDeltaUpdate audioDeltaUpdate:
                    HandleAudioDelta(audioDeltaUpdate, speakerOutput);
                    break;

                case ConversationOutputTranscriptionDeltaUpdate outputTranscriptionDeltaUpdate:
                    HandleOutputTranscription(outputTranscriptionDeltaUpdate);
                    break;

                case ConversationItemFinishedUpdate itemFinishedUpdate:
                    if (HandleItemFinished(itemFinishedUpdate, finishConversationTool))
                    {
                        return; // End the conversation
                    }
                    break;

                case ConversationErrorUpdate errorUpdate:
                    HandleError(errorUpdate);
                    return;

                default:
                    Console.WriteLine("Unhandled update type.");
                    break;
            }
        }
    }

    private static void HandleSessionStarted(RealtimeConversationSession session)
    {
        Console.WriteLine(" <<< Connected: session started");

        _ = Task.Run(async () =>
        {
            try
            {
                using MicrophoneAudioStream microphoneInput = MicrophoneAudioStream.Start();
                Console.WriteLine(" >>> Listening to microphone input");
                Console.WriteLine(" >>> (Just tell the app you're done to finish)");
                Console.WriteLine();
                await session.SendAudioAsync(microphoneInput);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Microphone input failed: {ex.Message}");
            }
        });
    }

    private static void HandleSpeechStarted(SpeakerOutput speakerOutput)
    {
        Console.WriteLine(" <<< Start of speech detected");
        speakerOutput.ClearPlayback();
    }

    private static void HandleSpeechFinished()
    {
        Console.WriteLine(" <<< End of speech detected");
    }

    private static void HandleInputTranscription(ConversationInputTranscriptionFinishedUpdate transcriptionFinishedUpdate)
    {
        Console.WriteLine($" >>> USER: {transcriptionFinishedUpdate.Transcript}");
    }

    private static void HandleAudioDelta(ConversationAudioDeltaUpdate audioDeltaUpdate, SpeakerOutput speakerOutput)
    {
        speakerOutput.EnqueueForPlayback(audioDeltaUpdate.Delta);
    }

    private static void HandleOutputTranscription(ConversationOutputTranscriptionDeltaUpdate outputTranscriptionDeltaUpdate)
    {
        Console.Write(outputTranscriptionDeltaUpdate.Delta);
    }

    private static bool HandleItemFinished(ConversationItemFinishedUpdate itemFinishedUpdate, ConversationFunctionTool finishConversationTool)
    {
        Console.WriteLine();
        if (itemFinishedUpdate.FunctionName == finishConversationTool.Name)
        {
            Console.WriteLine(" <<< Finish tool invoked -- ending conversation!");
            return true;
        }
        return false;
    }

    private static void HandleError(ConversationErrorUpdate errorUpdate)
    {
        Console.WriteLine();
        Console.WriteLine($" <<< ERROR: {errorUpdate.ErrorMessage}");
        Console.WriteLine(errorUpdate.GetRawContent().ToString());
    }

}