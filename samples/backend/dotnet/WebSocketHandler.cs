

using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

public class WebSocketHandler
{
    private readonly RequestDelegate _next;

    public WebSocketHandler(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Path == "/ws")
        {
            if (context.WebSockets.IsWebSocketRequest)
            {
                var webSocket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
                RealtimeSession session = new();
                await session.HandleAsync(webSocket).ConfigureAwait(false);
            }
            else
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
            }
        }
        else
        {
            await _next(context);
        }
    }
}