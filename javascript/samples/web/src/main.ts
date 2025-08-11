// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Player } from "./player.ts";
import { Recorder } from "./recorder.ts";
import "./style.css";
import { LowLevelRTClient, SessionUpdateMessage, Voice } from "rt-client";

let realtimeStreaming: LowLevelRTClient;
let audioRecorder: Recorder;
let audioPlayer: Player;

// Cache for product data loaded from /products.json
let productData: Record<string, { prompt: string; promptFile?: string }> | null = null;
const productPromptCache: Record<string, string> = {};

async function ensureProductDataLoaded() {
  if (productData) return;
  try {
    const res = await fetch("/products.json", { cache: "no-cache" });
    if (res.ok) {
      productData = await res.json();
    } else {
      console.warn("Failed to load products.json:", res.status, res.statusText);
      productData = {};
    }
  } catch (e) {
    console.warn("Error loading products.json", e);
    productData = {};
  }
}

// Populate the product dropdown from the JSON so adding products is config-only
async function populateProductDropdown() {
  await ensureProductDataLoaded();
  if (!productData) return;
  const current = formProductSelection.value;
  formProductSelection.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "";
  formProductSelection.appendChild(empty);
  Object.keys(productData)
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      formProductSelection.appendChild(opt);
    });
  if (current && productData[current]) {
    formProductSelection.value = current;
  }
}

async function start_realtime(endpoint: string, apiKey: string, deploymentOrModel: string) {
    realtimeStreaming = new LowLevelRTClient(new URL(endpoint), { key: apiKey }, { deployment: deploymentOrModel });

  try {
    console.log("sending session config");
    await ensureProductDataLoaded();
    await realtimeStreaming.send(await createConfigMessage());
  } catch (error) {
    console.log(error);
    makeNewTextBlock("[Connection error]: Unable to send initial config message. Please check your endpoint and authentication details.");
    setFormInputState(InputState.ReadyToStart);
    return;
  }
  console.log("sent");
  await Promise.all([resetAudio(true), handleRealtimeMessages()]);
}

async function getProductPrompt(product: string): Promise<string | null> {
  await ensureProductDataLoaded();
  const meta = productData?.[product];
  if (!meta) return null;

  // 1) Prefer inline prompt if provided
  if (meta.prompt && meta.prompt.trim().length > 0) {
    return meta.prompt.trim();
  }

  // 2) Otherwise, load from promptFile if provided
  const file = meta.promptFile;
  if (!file) return null;
  if (productPromptCache[file]) return productPromptCache[file];

  try {
    const res = await fetch(`/product-prompts/${file}`, { cache: "no-cache" });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    productPromptCache[file] = text;
    return text;
  } catch {
    return null;
  }
}

async function createConfigMessage() : Promise<SessionUpdateMessage> {

  let configMessage : SessionUpdateMessage = {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
      },
      input_audio_transcription: {
        model: "whisper-1"
      }
    }
  };

  const systemMessage = getSystemMessage();
  const temperature = getTemperature();
  const voice = getVoice();
  const product = getProductTopic();

  if (systemMessage) {
    configMessage.session.instructions = systemMessage;
  }

  if (product) {
    const productPrompt = await getProductPrompt(product);
    const productInstruction = productPrompt
      ? `Product context (${product}): ${productPrompt}`
      : `The topic is ${product}.`;
    if (configMessage.session.instructions) {
      configMessage.session.instructions += " " + productInstruction;
    } else {
      configMessage.session.instructions = productInstruction;
    }
  }
  if (!isNaN(temperature)) {
    configMessage.session.temperature = temperature;
  }
  if (voice) {
    configMessage.session.voice = voice;
  }

  return configMessage;
}

async function handleRealtimeMessages() {
  for await (const message of realtimeStreaming.messages()) {
    let consoleLog = "" + message.type;

    switch (message.type) {
      case "session.created":
        setFormInputState(InputState.ReadyToStop);
        makeNewTextBlock("<< Session Started >>");
        makeNewTextBlock();
        break;
      case "response.audio_transcript.delta":
        appendToTextBlock(message.delta);
        break;
      case "response.audio.delta":
        const binary = atob(message.delta);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const pcmData = new Int16Array(bytes.buffer);
        audioPlayer.play(pcmData);
        break;

      case "input_audio_buffer.speech_started":
        makeNewTextBlock("<< Speech Started >>");
        let textElements = formReceivedTextContainer.children;
        latestInputSpeechBlock = textElements[textElements.length - 1];
        makeNewTextBlock();
        audioPlayer.clear();
        break;
      case "conversation.item.input_audio_transcription.completed":
        latestInputSpeechBlock.textContent += " User: " + message.transcript;
        break;
      case "response.done":
        formReceivedTextContainer.appendChild(document.createElement("hr"));
        break;
      default:
        consoleLog = JSON.stringify(message, null, 2);
        break
    }
    if (consoleLog) {
      console.log(consoleLog);
    }
  }
  resetAudio(false);
}

/**
 * Basic audio handling
 */

let recordingActive: boolean = false;
let buffer: Uint8Array = new Uint8Array();

function combineArray(newData: Uint8Array) {
  const newBuffer = new Uint8Array(buffer.length + newData.length);
  newBuffer.set(buffer);
  newBuffer.set(newData, buffer.length);
  buffer = newBuffer;
}

function processAudioRecordingBuffer(data: Buffer) {
  const uint8Array = new Uint8Array(data);
  combineArray(uint8Array);
  if (buffer.length >= 4800) {
    const toSend = new Uint8Array(buffer.slice(0, 4800));
    buffer = new Uint8Array(buffer.slice(4800));
    const regularArray = String.fromCharCode(...toSend);
    const base64 = btoa(regularArray);
    if (recordingActive) {
      realtimeStreaming.send({
        type: "input_audio_buffer.append",
        audio: base64,
      });
    }
  }

}

async function resetAudio(startRecording: boolean) {
  recordingActive = false;
  if (audioRecorder) {
    audioRecorder.stop();
  }
  if (audioPlayer) {
    audioPlayer.clear();
  }
  audioRecorder = new Recorder(processAudioRecordingBuffer);
  audioPlayer = new Player();
  audioPlayer.init(24000);
  if (startRecording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder.start(stream);
    recordingActive = true;
  }
}

/**
 * UI and controls
 */

const formReceivedTextContainer = document.querySelector<HTMLDivElement>(
  "#received-text-container",
)!;
const formStartButton =
  document.querySelector<HTMLButtonElement>("#start-recording")!;
const formStopButton =
  document.querySelector<HTMLButtonElement>("#stop-recording")!;
const formClearAllButton =
  document.querySelector<HTMLButtonElement>("#clear-all")!;
const formSessionInstructionsField =
  document.querySelector<HTMLTextAreaElement>("#session-instructions")!;
const formTemperatureField = document.querySelector<HTMLInputElement>("#temperature")!;
const formVoiceSelection = document.querySelector<HTMLSelectElement>("#voice")!;
const formProductSelection = document.querySelector<HTMLSelectElement>("#product-topic")!;

let latestInputSpeechBlock: Element;

enum InputState {
  Working,
  ReadyToStart,
  ReadyToStop,
}

function setFormInputState(state: InputState) {
  formStartButton.disabled = state != InputState.ReadyToStart;
  formStopButton.disabled = state != InputState.ReadyToStop;
  formSessionInstructionsField.disabled = state != InputState.ReadyToStart;
  formProductSelection.disabled = state != InputState.ReadyToStart;
}

function getSystemMessage(): string {
  return formSessionInstructionsField.value || "";
}

function getTemperature(): number {
  return parseFloat(formTemperatureField.value);
}

function getVoice(): Voice {
  return formVoiceSelection.value as Voice;
}

function getProductTopic(): string {
  return formProductSelection.value || "";
}

function makeNewTextBlock(text: string = "") {
  let newElement = document.createElement("p");
  newElement.textContent = text;
  formReceivedTextContainer.appendChild(newElement);
}

function appendToTextBlock(text: string) {
  let textElements = formReceivedTextContainer.children;
  if (textElements.length == 0) {
    makeNewTextBlock();
  }
  textElements[textElements.length - 1].textContent += text;
}

// Populate product dropdown on load
void populateProductDropdown();

formStartButton.addEventListener("click", async () => {
  setFormInputState(InputState.Working);

  const endpoint = import.meta.env.VITE_OPEN_AI_ENDPOINT || "";
  const key = import.meta.env.VITE_OPEN_AI_KEY || "";
  const deploymentOrModel = import.meta.env.VITE_OPEN_AI_DEPLOYMENT || "";

  console.log("Starting with:", { endpoint, key, deploymentOrModel });
  if (!endpoint && !deploymentOrModel) {
    alert("Endpoint and Deployment are required for Azure OpenAI");
    return;
  }

  if (!deploymentOrModel) {
    alert("Model is required for OpenAI");
    return;
  }

  if (!key) {
    alert("API Key is required");
    return;
  }

  try {
    start_realtime(endpoint, key, deploymentOrModel);
  } catch (error) {
    console.log(error);
    setFormInputState(InputState.ReadyToStart);
  }
});

formStopButton.addEventListener("click", async () => {
  setFormInputState(InputState.Working);
  resetAudio(false);
  realtimeStreaming.close();
  setFormInputState(InputState.ReadyToStart);
});

formClearAllButton.addEventListener("click", async () => {
  formReceivedTextContainer.innerHTML = "";
});