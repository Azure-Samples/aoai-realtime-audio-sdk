using System.Text.Json.Serialization;

namespace AspNetCoreMvcRealtimeMiddletier.ClientMessages;

/// <summary>
/// The base representation of a simplified protocol message that can sent by the frontend client and received by
/// this middle tier implementation.
/// </summary>
/// <param name="type"></param>
public abstract class ClientReceivableMessage(string type) : ClientMessage(type)
{ }

/// <summary>
/// A user message input, typically associated with text provided by the user.
/// </summary>
/// <param name="text"></param>
public class ClientReceivableUserMessage(string text) : ClientReceivableMessage("user_message")
{
    [JsonPropertyName("text")]
    public string Text { get; } = text;
}