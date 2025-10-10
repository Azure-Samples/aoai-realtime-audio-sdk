using System.Text.Json.Serialization;

namespace AspNetCoreMvcRealtimeMiddletier.ClientMessages;

/// <summary>
/// A base representation of a simplified protocol message that can be sent from this middle tier implementation to
/// a client frontend.
/// </summary>
/// <param name="type"></param>
public abstract class ClientSendableMessage(string type) : ClientMessage(type)
{ }

/// <summary>
/// A base representation of a simplified protocol control message that can be sentfrom this middle tier implementation
/// to a client frontend.
/// </summary>
/// <param name="action"></param>
public abstract class ClientSendableControlMessage(string action) : ClientSendableMessage("control")
{
    [JsonPropertyName("action")]
    public string Action { get; } = action;
}

/// <summary>
/// A message sent from this middle tier implementation to the client frontend upon successful connection
/// establishment. Includes a brief greeting message.
/// </summary>
/// <param name="greeting"></param>
public class ClientSendableConnectedMessage(string greeting) : ClientSendableControlMessage("connected")
{
    [JsonPropertyName("greeting")]
    public string Greeting { get; set; } = greeting;
}

/// <summary>
/// A message sent from this middle tier implementation to the client frontend when a start of speech is detected in
/// the user input audio.
/// </summary>
public class ClientSendableSpeechStartedMessage : ClientSendableControlMessage
{
    public ClientSendableSpeechStartedMessage() : base("speech_started") { }
}

/// <summary>
/// A message sent from this middle tier implementation to the client frontend when a new, incremental piece of
/// generated text content is available.
/// </summary>
/// <param name="delta"></param>
/// <param name="contentId"></param>
public class ClientSendableTextDeltaMessage(string delta, string contentId) : ClientSendableMessage("text_delta")
{
    [JsonPropertyName("delta")]
    public string Delta { get; set; } = delta;

    [JsonPropertyName("id")]
    public string ContentId { get; set; } = contentId;
}

/// <summary>
/// A message sent from this middle tier implementation to the client frontend when a transcription of user input
/// audio is available.
/// </summary>
/// <param name="eventId"></param>
/// <param name="transcription"></param>
public class ClientSendableTranscriptionMessage(string eventId, string transcription) : ClientSendableMessage("transcription")
{
    [JsonPropertyName("id")]
    public string EventId { get; set; } = eventId;

    [JsonPropertyName("text")]
    public string Transcription { get; set; } = transcription;
}
