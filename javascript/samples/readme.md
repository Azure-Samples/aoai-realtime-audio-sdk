# Azure OpenAI /realtime: an interactive chat using node-js


## Prereqs

1. Node.js installation (https://nodejs.org)
2. Environment that can run a localhost web server

### Getting the library package

For these samples to work, the client library package is required to be downloaded to this folder (alternatively, it can be build from source and copied here). For that we provide a couple of scripts:

- [download-pkg.sh](./download-pkg.sh) for bash
    > Note that this script requires `jq` to be installed.

- [download-pkg.ps1](./download-pkg.ps1) for PowerShell

These can be run by typing `./download-pkg.sh` or `pwsh ./download-pkg.ps1` respectively.

## Using the sample

1. Navigate to this folder
2. Run `npm install` to download a small number of dependency packages (see `package.json`)
3. Run `npm run dev` to start the web server, navigating any firewall permissions prompts
4. Use any of the provided URIs from the console output, e.g. `http://localhost:5173/`, in a browser
5. Add authentication details:

    #### Azure Open AI

    For Azure OpenAI both an `Endpoint` and a `API Key` are required to run the sample. Note that here sample is the  endpoint of your Azure OpenAI resource (without the path)

    #### OpenAI

    For connecting with OpenAI no endpoint is required and you only need to provide the `API Key`

7. Click the "Record" button to start the session; accept any microphone permissions dialog
8. You should see a `<< Session Started >>` message in the left-side output, after which you can speak to the app
9. You can interrupt the chat at any time by speaking and completely stop the chat by using the "Stop" button
10. Optionally, you can provide a System Message (e.g. try "You always talk like a friendly pirate") or a custom temperature; these will reflect upon the next session start

## Known issues

1. Connection errors are not yet gracefully handled and looping error spew may be observed in script debug output. Please just refresh the web page if an error appears.
2. Voice selection is not yet supported.
3. More authentication mechanisms, including keyless support via Entra, will come in a future service update.

## Code description

This sample uses a custom client to simplify the usage of the realtime API. The client package can be obtained by either building the [library](../standalone/) or by downloading it using the scripts provided:

- [bash ](./download-pkg.sh) - Note that  this script requires `jq` to be installed.
- [PowerShell](./download-pkg.ps1)

The primary file demonstrating `/realtime` use is [src/main.ts](./src/main.ts); the first few functions demonstrate connecting to `/realtime` using the client, sending an inference configuration message, and then processing the send/receive of messages on the connection.
