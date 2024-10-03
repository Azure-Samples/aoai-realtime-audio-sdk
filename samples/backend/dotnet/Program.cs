using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();

app.UseWebSockets();

app.UseMiddleware<WebSocketHandler>();

app.MapControllers();

app.Run();
