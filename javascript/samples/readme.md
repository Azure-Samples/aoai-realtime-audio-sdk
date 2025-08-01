# Azure OpenAI /realtime: an interactive chat using node-js


## Prereqs

1. Node.js installation (https://nodejs.org)
2. Environment that can run a localhost web server

### Getting the library package

The web sample havs the Standalone client library package `rt-client-0.4.6.tgz` as a custom dependency. `./web/package.json` references the file like this `"rt-client": "file:../rt-client-0.4.6.tgz"` from the `samples` folder.
Installer scripts for bash and PowerShell are provided in this folder as `[download-pkg.sh](./download-pkg.sh)` and `[.download-pkg.ps1](./download-pkg.ps1)` respectively. These scripts place the `.tgz` file in the current folder. You can also build the package from source in the `../standalone/` folder and copy it here.

Download the library package file using bash (requires `jq`):
```bash
./download-pkg.sh
```

Download the library package file using PowerShell:
```bash
./download-pkg.ps1
```

## Using the sample

1. In terminal, navigate to the `./web/` folder
2. Run `npm install` to install dependencies (see `package.json`)
3. Run `npm run dev` to start the web server, navigating any firewall permissions prompts
4. Use the provided URIs from the console output, e.g. `http://localhost:5173/`, to open the app in a browser
5. Add authentication details:

    #### Azure Open AI

    For Azure OpenAI both an `Endpoint` and a `API Key` are required to run the sample. Note that here sample is the  endpoint of your Azure OpenAI resource (without the path)

    #### OpenAI

    For connecting with OpenAI no provider or endpoint is required. You only need to provide the model name and `API Key`

7. Click the "Record" button to start the session; accept any microphone permissions dialog
8. You should see a `<< Session Started >>` message in the left-side output, after which you can speak to the app
9. You can interrupt the chat at any time by speaking and completely stop the chat by using the "Stop" button
10. Optionally, you can provide a System Message (e.g. try "You always talk like a friendly pirate") or a custom temperature; these will reflect upon the next session start

## Known issues

1. Connection errors are not yet gracefully handled and looping error spew may be observed in script debug output. Please just refresh the web page if an error appears.
2. Voice selection is not yet supported.
3. More authentication mechanisms, including keyless support via Entra, will come in a future service update.

## Code description

This sample uses a custom client to simplify the usage of the realtime API. The client package can be inspected in the `[../standalone/src](../standalone/src/)` folder or by downloading it using the scripts provided above.

The primary file demonstrating `/realtime` use is [src/main.ts](./src/main.ts); the first few functions demonstrate connecting to `/realtime` using the client, sending an inference configuration message, and then processing the send/receive of messages on the connection.
