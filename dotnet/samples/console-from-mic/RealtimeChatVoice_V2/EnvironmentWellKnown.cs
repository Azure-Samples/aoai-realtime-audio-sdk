using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

public static class EnvironmentWellKnown
{
    private static string? _deploymentName;
    public static string DeploymentName => _deploymentName ??= Environment.GetEnvironmentVariable(Wellknown.AzureOpenAIDeployment);

    private static string? _endpoint;
    public static string Endpoint => _endpoint ??= Environment.GetEnvironmentVariable(Wellknown.AzureOpenAIEndpoint);

    private static string? _apiKey;
    public static string ApiKey => _apiKey ??= Environment.GetEnvironmentVariable(Wellknown.AzureOpenAIApiKey);

    private static string? _bingApiKey;
    public static string BingApiKey => _bingApiKey ??= Environment.GetEnvironmentVariable(Wellknown.BingApiKey);

    private static string? _openAIApiKey;
    public static string OpenAIApiKey => _openAIApiKey ??= Environment.GetEnvironmentVariable(Wellknown.OpenAIApiKey);
}
