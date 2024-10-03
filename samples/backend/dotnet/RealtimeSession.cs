using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI.RealtimeConversation;

public class RealtimeSession
{
    private static async Task<(byte[] Data, bool Binary)?> ReceiveAsync(WebSocket webSocket, CancellationToken cancellationToken)
    {
        var buffer = new byte[1024 * 4];
        MemoryStream memoryStream = new();
        bool binary = false;
        while (true)
        {
            var result = await webSocket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (result.MessageType is WebSocketMessageType.Close)
            {
                return null;
            }
            binary = result.MessageType is WebSocketMessageType.Binary;

            memoryStream.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
            {
                return (memoryStream.ToArray(), binary);
            }
        }
    }

    public async Task HandleAsync(WebSocket webSocket)
    {
        string endpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")!;
        string deployment = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT")!;
        AzureOpenAIClient topLevelClient = new(endpoint: new(endpoint), credential: new DefaultAzureCredential());
        RealtimeConversationClient conversationClient = topLevelClient.GetRealtimeConversationClient(deployment);
        ConversationSessionOptions options = new()
        {
            Instructions = "You are a helpful assistant.",
        };
        var session = await conversationClient.StartConversationSessionAsync().ConfigureAwait(false);
        await session.ConfigureSessionAsync(options);
        CancellationTokenSource cts = new();
        var userIncoming = Task.Run(async () =>
        {
            try
            {
                while (true)
                {
                    var result = await ReceiveAsync(webSocket, cts.Token).ConfigureAwait(false);
                    if (result is null)
                    {
                        break;
                    }
                    var (data, binary) = result.Value;
                    if (binary)
                    {
                        await session.SendAudioAsync(BinaryData.FromBytes(data), cts.Token).ConfigureAwait(false);
                    }
                    else
                    {
                        throw new NotImplementedException();
                    }
                }
            }
            finally
            {
                cts.Cancel();
            }
        }, cts.Token);
        var openAIIncoming = Task.Run(async () =>
        {
            try
            {
                await foreach (var update in session.ReceiveUpdatesAsync(cts.Token))
                {
                    var sendTask = update switch {
                        ConversationAudioDeltaUpdate audioDelta => webSocket.SendAsync(audioDelta.Delta.ToArray(), WebSocketMessageType.Binary, true, cts.Token),
                        ConversationOutputTranscriptionDeltaUpdate transcriptionDelta => webSocket.SendAsync(Encoding.UTF8.GetBytes(transcriptionDelta.Delta), WebSocketMessageType.Text, true, cts.Token),
                        _ => Task.CompletedTask,
                    };
                    await sendTask.ConfigureAwait(false);

                }
            }
            finally
            {
                cts.Cancel();
            }
        }, cts.Token);
        await Task.WhenAll(userIncoming, openAIIncoming).ConfigureAwait(false);
    }
}