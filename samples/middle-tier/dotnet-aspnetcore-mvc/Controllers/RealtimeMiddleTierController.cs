using AspNetCoreMvcRealtimeMiddletier.ClientMessages;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.AspNetCore.Mvc;
using OpenAI;
using OpenAI.RealtimeConversation;
using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace AspNetCoreMvcRealtimeMiddletier.Controllers;

// Disabling the OPENAI002 warning acknowledges the "beta" state of the /realtime API.
#pragma warning disable OPENAI002

public class RealtimeMiddleTierController(IConfiguration configuration) : Controller
{
    public IConfiguration Configuration { get; } = configuration;
    public WebSocket? WebSocketToClient { get; set; }
    public RealtimeConversationSession? RealtimeSessionToService { get; set; }
    public byte[] WebSocketReceiveBuffer { get; } = new byte[1024 * 8];

    [Route("/realtime")]
    public async Task HandleIncomingRequest()
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest)
        {
            HttpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        CancellationTokenSource cancellationSource = new();

        WebSocketToClient = await HttpContext.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
        RealtimeSessionToService = await GetConfiguredRealtimeSessionAsync(cancellationSource.Token).ConfigureAwait(false);

        await SendMessageToClientAsync(new ClientSendableConnectedMessage(
            greeting: "You are now connected to an ASP.NET Core MVC server"));

        await Task.WhenAny(
            HandleMessagesFromClientAsync(cancellationSource.Token),
            HandleUpdatesFromServiceAsync(cancellationSource.Token)).ConfigureAwait(false);
    }

    /// <summary>
    /// Creates and configures a RealtimeConversationSession based on IConfiguration data available.
    /// </summary>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    /// <exception cref="InvalidOperationException"></exception>
    private async Task<RealtimeConversationSession> GetConfiguredRealtimeSessionAsync(CancellationToken cancellationToken = default)
    {
        RealtimeConversationClient? realtimeClient;

        string? rawAzureEndpoint = Configuration.GetValue<string>("AZURE_OPENAI_ENDPOINT");
        string? rawAzureApiKey = Configuration.GetValue<string>("AZURE_OPENAI_API_KEY");
        string? azureDeployment = Configuration.GetValue<string>("AZURE_OPENAI_DEPLOYMENT");
        string? openAIApiKey = Configuration.GetValue<string>("OPENAI_API_KEY");
        string? nonDefaultOpenAIEndpoint = Configuration.GetValue<string>("OPENAI_ENDPOINT");
        string? nonDefaultOpenAIModel = Configuration.GetValue<string>("OPENAI_MODEL");

        if (rawAzureEndpoint is not null && azureDeployment is not null)
        {
            Uri azureEndpoint = new(rawAzureEndpoint);
            AzureOpenAIClient azureClient = rawAzureApiKey is not null
                ? new(azureEndpoint, new ApiKeyCredential(rawAzureApiKey))
                : new(azureEndpoint, new DefaultAzureCredential());
            realtimeClient = azureClient.GetRealtimeConversationClient(azureDeployment);
        }
        else if (openAIApiKey is not null)
        {
            OpenAIClientOptions clientOptions = new()
            {
                Endpoint = nonDefaultOpenAIEndpoint is not null ? new(nonDefaultOpenAIEndpoint) : null,
            };
            OpenAIClient client = new(new ApiKeyCredential(openAIApiKey), clientOptions);
            realtimeClient = client.GetRealtimeConversationClient(nonDefaultOpenAIModel ?? "gpt-4o-realtime-preview");
        }
        else
        {
            throw new InvalidOperationException("""
                Invalid configuration.
                
                If using Azure OpenAI, AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT must be available; Entra
                authentication will then be used unless an optional AZURE_OPENAI_API_KEY value is present.

                Otherwise, OPENAI_API_KEY must be present and optional OPENAI_ENDPOINT and OPENAI_MODEL values will
                override defaults if available.
                """);
        }

        RealtimeConversationSession session
            = await realtimeClient.StartConversationSessionAsync(cancellationToken).ConfigureAwait(false);
        ConversationSessionOptions sessionOptions = new()
        {
            InputTranscriptionOptions = new()
            {
                Model = "whisper-1",
            }
        };
        await session.ConfigureSessionAsync(sessionOptions, cancellationToken);
        return session;
    }

    /// <summary>
    /// The task that manages receipt of incoming simplified protocol messages from the frontend client.
    /// </summary>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    /// <exception cref="InvalidOperationException"></exception>
    private async Task HandleMessagesFromClientAsync(CancellationToken cancellationToken = default)
    {
        if (WebSocketToClient is null)
        {
            throw new InvalidOperationException($"Internal error: attempting to start client WebSocket loop without a WebSocket");
        }
        if (RealtimeSessionToService is null)
        {
            throw new InvalidOperationException($"Internal error: attempting to start client WebSocket loop without an active session");
        }

        WebSocketReceiveResult receiveResult
            = await WebSocketToClient.ReceiveAsync(WebSocketReceiveBuffer, cancellationToken).ConfigureAwait(false);

        while (!receiveResult.CloseStatus.HasValue)
        {
            if (receiveResult.MessageType == WebSocketMessageType.Binary)
            {
                ArraySegment<byte> bytesReceivedFromClient = new(WebSocketReceiveBuffer, 0, receiveResult.Count);
                // Temporary workaround for pre-2.2 bug with SendInputAudioAsync(BinaryData)
                await SendAudioToServiceViaWorkaroundAsync(bytesReceivedFromClient, cancellationToken).ConfigureAwait(false);
                //await RealtimeSessionToService.SendInputAudioAsync(
                //    BinaryData.FromBytes(bytesReceivedFromClient),
                //    cancellationToken)
                //        .ConfigureAwait(false);
            }
            else
            {
                string rawMessageFromClient = Encoding.UTF8.GetString(WebSocketReceiveBuffer, 0, receiveResult.Count);
                ClientMessage? clientMessage = JsonSerializer.Deserialize<ClientMessage>(rawMessageFromClient);

                if (clientMessage is ClientReceivableUserMessage clientUserMessage)
                {
                    await RealtimeSessionToService.AddItemAsync(
                        ConversationItem.CreateUserMessage([clientUserMessage.Text]), cancellationToken).ConfigureAwait(false);
                    await RealtimeSessionToService.StartResponseAsync(cancellationToken).ConfigureAwait(false);
                }
                else
                {
                    throw new InvalidOperationException($"Unexpected message from client: {rawMessageFromClient}");
                }
            }

            receiveResult = await WebSocketToClient.ReceiveAsync(WebSocketReceiveBuffer, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// The task that manages the incoming updates from realtime API messages and model responses.
    /// </summary>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    /// <exception cref="InvalidOperationException"></exception>
    private async Task HandleUpdatesFromServiceAsync(CancellationToken cancellationToken = default)
    {
        if (WebSocketToClient is null)
        {
            throw new InvalidOperationException($"Internal error: attempting to start service session loop without a WebSocket");
        }
        if (RealtimeSessionToService is null)
        {
            throw new InvalidOperationException($"Internal error: attempting to start service session loop without a client WebSocket");
        }

        await foreach (ConversationUpdate update in RealtimeSessionToService.ReceiveUpdatesAsync(cancellationToken).ConfigureAwait(false))
        {
            if (update is ConversationInputSpeechStartedUpdate)
            {
                await SendMessageToClientAsync(new ClientSendableSpeechStartedMessage(), cancellationToken).ConfigureAwait(false);
            }

            if (update is ConversationItemStreamingPartDeltaUpdate deltaUpdate)
            {
                string contentIdForClient = $"{deltaUpdate.ItemId}-{deltaUpdate.ContentPartIndex}";

                if (!string.IsNullOrEmpty(deltaUpdate.Text))
                {
                    ClientSendableTextDeltaMessage clientDeltaMessage = new(deltaUpdate.Text, contentIdForClient);
                    await SendMessageToClientAsync(clientDeltaMessage, cancellationToken).ConfigureAwait(false);
                }
                if (!string.IsNullOrEmpty(deltaUpdate.AudioTranscript))
                {
                    ClientSendableTextDeltaMessage clientDeltaMessage = new(deltaUpdate.AudioTranscript, contentIdForClient);
                    await SendMessageToClientAsync(clientDeltaMessage, cancellationToken).ConfigureAwait(false);
                }
                if (deltaUpdate.AudioBytes is not null)
                {
                    await WebSocketToClient.SendAsync(
                        deltaUpdate.AudioBytes.ToArray(),
                        WebSocketMessageType.Binary,
                        endOfMessage: true,
                        cancellationToken)
                            .ConfigureAwait(false);
                }
            }

            if (update is ConversationInputTranscriptionFinishedUpdate transcriptionFinishedUpdate)
            {
                ClientSendableTranscriptionMessage transcriptionMessage = new(
                    transcriptionFinishedUpdate.ItemId,
                    transcriptionFinishedUpdate.Transcript);
                await SendMessageToClientAsync(transcriptionMessage, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// A helper that serializes and transmits a simplified protocol message that can be sent to a frontend client.
    /// </summary>
    /// <param name="message"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    /// <exception cref="InvalidOperationException"></exception>
    private async Task SendMessageToClientAsync(ClientSendableMessage message, CancellationToken cancellationToken = default)
    {
        if (WebSocketToClient is null)
        {
            throw new InvalidOperationException($"Internal error: attempting to send a client message with no WebSocket");
        }

        string serializedMessage = JsonSerializer.Serialize(message, message.GetType());
        byte[] messageBytes = Encoding.UTF8.GetBytes(serializedMessage);
        await WebSocketToClient.SendAsync(
            messageBytes,
            WebSocketMessageType.Text,
            endOfMessage: true,
            cancellationToken)
                .ConfigureAwait(false);
    }

    /// <summary>
    /// A temporary workaround method, needed for OpenAI library versions prior to 2.2, to bypass a bug
    /// <see cref="RealtimeConversationSession.SendInputAudioAsync(BinaryData, CancellationToken)"/>.
    /// </summary>
    /// <param name="audioSegment"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    /// <exception cref="InvalidOperationException"></exception>
    private async Task SendAudioToServiceViaWorkaroundAsync(ArraySegment<byte> audioSegment, CancellationToken cancellationToken = default)
    {
        if (RealtimeSessionToService is null)
        {
            throw new InvalidOperationException($"Internal error: attempting to send audio to service with no active session");
        }

        string base64Audio = Convert.ToBase64String(audioSegment);
        BinaryData audioBody = BinaryData.FromString($$"""
        {
            "type": "input_audio_buffer.append",
            "audio": "{{base64Audio}}"
        }
        """);
        RequestOptions cancellationOptions = new()
        {
            CancellationToken = cancellationToken,
        };
        await RealtimeSessionToService.SendCommandAsync(audioBody, cancellationOptions).ConfigureAwait(false);
    }

    /// <inheritdoc/>
    protected override void Dispose(bool disposing)
    {
        WebSocketToClient?.Dispose();
        WebSocketToClient = null;
        RealtimeSessionToService?.Dispose();
        RealtimeSessionToService = null;
        base.Dispose(disposing);
    }
}