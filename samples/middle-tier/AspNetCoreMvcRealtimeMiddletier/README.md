## /realtime Middle Tier using ASP.NET Core MVC

*Last updated on 2024-12-13 for 2.1.0-beta versions of OpenAI and Azure.AI.OpenAI*

This sample demonstrates a rudimentary middle tier service implementation that manages two connections:

1. A connection with a client frontend, facilitated using a demonstrative simplified protocol
2. A connection with an OpenAI /realtime endpoint, facilitated via SDK library use

### Running

If the `AZURE_OPENAI_ENDPOINT` variable is set (via environment variable or IConfiguration), the middle tier will attempt to connect to that URI as an Azure OpenAI resource.

- When providing an `AZURE_OPENAI_ENDPOINT` value, `AZURE_OPENAI_DEPLOYMENT` is also required and should specify the deployment name of a model deployment compatible with `/realtime`, e.g. `gpt-4o-realtime-preview`
- If provided, the optional `AZURE_OPENAI_API_KEY` value will be used to authenticate. Otherwise, `DefaultAzureCredential` will be used for Entra authentication

If not using Azure OpenAI, an OpenAI endpoint will be used:

- `OPENAI_API_KEY` is required and will be used to authenticate
- If provided, an optional value of `OPENAI_ENDPOINT` will be used instead of the default
- If provided, an optional value of `OPENAI_MODEL` will be used instead of a default of `gpt-4o-realtime-preview`

### Code

The majority of the application's logic exists in [the `RealtimeMiddleTierController` implementation](Controllers/RealtimeMiddleTierController.cs). On a per-request basis, this controller accepts the WebSocket connection from the frontend client, connects to the configured endpoint for `/realtime`, and then starts and blocks on receive loop tasks for each of the two connections.

The `ClientMessages` folder has basic classes for the simplified protocol used to communicate between the frontend client and middle tier.