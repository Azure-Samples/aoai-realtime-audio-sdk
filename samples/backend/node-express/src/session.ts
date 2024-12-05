import { WebSocket } from "ws";
import {
  RTClient,
  RTResponse,
  RTInputAudioItem,
  RTTextContent,
  RTAudioContent,
} from "rt-client";
import { DefaultAzureCredential } from "@azure/identity";
import { AzureKeyCredential } from "@azure/core-auth";
import { Logger } from "pino";

interface TextDelta {
  id: string;
  type: "text_delta";
  delta: string;
}

interface Transcription {
  id: string;
  type: "transcription";
  text: string;
}

interface UserMessage {
  id: string;
  type: "user_message";
  text: string;
}

interface SpeechStarted {
  type: "control";
  action: "speech_started";
}

interface Connected {
  type: "control";
  action: "connected";
  greeting: string;
}

interface TextDone {
  type: "control";
  action: "text_done";
  id: string;
}

type ControlMessage = SpeechStarted | Connected | TextDone;

type WSMessage = TextDelta | Transcription | UserMessage | ControlMessage;

export class RTSession {
  private client: RTClient;
  private ws: WebSocket;
  private readonly sessionId: string;
  private logger: Logger;

  constructor(ws: WebSocket, backend: string | undefined, logger: Logger) {
    this.sessionId = crypto.randomUUID();
    this.ws = ws;
    this.logger = logger.child({ sessionId: this.sessionId });
    this.client = this.initializeClient(backend);
    this.setupEventHandlers();

    this.logger.info("New session created");
    this.initialize();
  }

  async initialize() {
    this.logger.debug("Configuring realtime session");
    await this.client.configure({
      modalities: ["text", "audio"],
      input_audio_format: "pcm16",
      input_audio_transcription: {
        model: "whisper-1",
      },
      turn_detection: {
        type: "server_vad",
      },
    });
    /* Send greeting */
    const greeting: Connected = {
      type: "control",
      action: "connected",
      greeting: "You are now connected to the a expressjs server",
    };
    this.send(greeting);
    this.logger.debug("Realtime session configured successfully");
    this.startEventLoop();
  }

  private send(message: WSMessage) {
    this.ws.send(JSON.stringify(message));
  }

  private initializeClient(backend: string | undefined): RTClient {
    this.logger.debug({ backend }, "Initializing RT client");

    if (backend === "azure") {
      return new RTClient(
        new URL(process.env.AZURE_OPENAI_ENDPOINT!),
        new DefaultAzureCredential(),
        { deployment: process.env.AZURE_OPENAI_DEPLOYMENT! },
      );
    }
    return new RTClient(new AzureKeyCredential(process.env.OPENAI_API_KEY!), {
      model: process.env.OPENAI_MODEL!,
    });
  }

  private setupEventHandlers() {
    this.logger.debug("Client configured successfully");

    this.ws.on("message", this.handleMessage.bind(this));
    this.ws.on("close", this.handleClose.bind(this));
    this.ws.on("error", (error) => {
      this.logger.error({ error }, "WebSocket error occurred");
    });
  }

  private async handleMessage(message: Buffer, isBinary: boolean) {
    try {
      if (isBinary) {
        await this.handleBinaryMessage(message);
      } else {
        await this.handleTextMessage(message);
      }
    } catch (error) {
      this.logger.error({ error }, "Error handling message");
    }
  }

  private async handleBinaryMessage(message: Buffer) {
    try {
      await this.client.sendAudio(new Uint8Array(message));
    } catch (error) {
      this.logger.error({ error }, "Failed to send audio data");
      throw error;
    }
  }

  private async handleTextMessage(message: Buffer) {
    const messageString = message.toString("utf-8");
    const parsed: WSMessage = JSON.parse(messageString);

    this.logger.debug({ messageType: parsed.type }, "Received text message");

    if (parsed.type === "user_message") {
      try {
        await this.client.sendItem({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: parsed.text }],
        });
        await this.client.generateResponse();
        this.logger.debug("User message processed successfully");
      } catch (error) {
        this.logger.error({ error }, "Failed to process user message");
        throw error;
      }
    }
  }

  private async handleClose() {
    this.logger.info("Session closing");
    try {
      await this.client.close();
      this.logger.info("Session closed successfully");
    } catch (error) {
      this.logger.error({ error }, "Error closing session");
    }
  }

  private async handleTextContent(content: RTTextContent) {
    try {
      const contentId = `${content.itemId}-${content.contentIndex}`;
      for await (const text of content.textChunks()) {
        const deltaMessage: TextDelta = {
          id: contentId,
          type: "text_delta",
          delta: text,
        };
        this.send(deltaMessage);
      }
      this.send({ type: "control", action: "text_done", id: contentId });
      this.logger.debug("Text content processed successfully");
    } catch (error) {
      this.logger.error({ error }, "Error handling text content");
      throw error;
    }
  }

  private async handleAudioContent(content: RTAudioContent) {
    const handleAudioChunks = async () => {
      for await (const chunk of content.audioChunks()) {
        this.ws.send(chunk.buffer);
      }
    };
    const handleAudioTranscript = async () => {
      const contentId = `${content.itemId}-${content.contentIndex}`;
      for await (const chunk of content.transcriptChunks()) {
        this.send({ id: contentId, type: "text_delta", delta: chunk });
      }
      this.send({ type: "control", action: "text_done", id: contentId });
    };

    try {
      await Promise.all([handleAudioChunks(), handleAudioTranscript()]);
      this.logger.debug("Audio content processed successfully");
    } catch (error) {
      this.logger.error({ error }, "Error handling audio content");
      throw error;
    }
  }

  private async handleResponse(event: RTResponse) {
    try {
      for await (const item of event) {
        if (item.type === "message") {
          for await (const content of item) {
            if (content.type === "text") {
              await this.handleTextContent(content);
            } else if (content.type === "audio") {
              await this.handleAudioContent(content);
            }
          }
        }
      }
      this.logger.debug("Response handled successfully");
    } catch (error) {
      this.logger.error({ error }, "Error handling response");
      throw error;
    }
  }

  private async handleInputAudio(event: RTInputAudioItem) {
    try {
      this.send({ type: "control", action: "speech_started" });
      await event.waitForCompletion();

      const transcription: Transcription = {
        id: (event as any).id as string,
        type: "transcription",
        text: event.transcription || "",
      };
      this.send(transcription);
      this.logger.debug(
        { transcriptionLength: transcription.text.length },
        "Input audio processed successfully",
      );
    } catch (error) {
      this.logger.error({ error }, "Error handling input audio");
      throw error;
    }
  }

  private async startEventLoop() {
    try {
      this.logger.debug("Starting event loop");
      for await (const event of this.client.events()) {
        if (event.type === "response") {
          await this.handleResponse(event);
        } else if (event.type === "input_audio") {
          await this.handleInputAudio(event);
        }
      }
    } catch (error) {
      this.logger.error({ error }, "Error in event loop");
      throw error;
    }
  }
}
