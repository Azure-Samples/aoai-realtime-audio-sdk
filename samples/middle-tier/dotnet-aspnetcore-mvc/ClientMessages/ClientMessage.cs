using System.Text.Json;
using System.Text.Json.Serialization;

namespace AspNetCoreMvcRealtimeMiddletier.ClientMessages;

/// <summary>
/// A base representation of a simplified protocol message communicated between the client frontend and this middle
/// tier implementation.
/// </summary>
/// <param name="type"></param>
[JsonConverter(typeof(ClientMessageJsonConverter))]
public abstract class ClientMessage(string type)
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = type;

    /// <summary>
    /// A converter is used to work around limitations with nested polymorphism via [JsonPolymorphic] and [JsonDerivedType].
    /// </summary>
    private class ClientMessageJsonConverter : JsonConverter<ClientMessage>
    {
        public override ClientMessage? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            using JsonDocument messageDocument = JsonDocument.ParseValue(ref reader);

            foreach (JsonProperty property in messageDocument.RootElement.EnumerateObject())
            {
                if (property.NameEquals("type"u8) && property.Value.GetString() is string typeDiscriminator)
                {
                    if (typeDiscriminator == "user_message")
                    {
                        return messageDocument.Deserialize<ClientReceivableUserMessage>();
                    }
                }
            }

            throw new NotImplementedException();
        }

        public override void Write(Utf8JsonWriter writer, ClientMessage value, JsonSerializerOptions options)
        {
            JsonSerializer.Serialize(writer, value, value.GetType(), options);
        }
    }
}
