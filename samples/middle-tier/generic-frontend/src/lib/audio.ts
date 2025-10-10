// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class Player {
  private playbackNode: AudioWorkletNode | null = null;

  async init(sampleRate: number) {
    if (this.playbackNode === null) {
      const audioContext = new AudioContext({ sampleRate });
      await audioContext.audioWorklet.addModule("playback-worklet.js");

      this.playbackNode = new AudioWorkletNode(audioContext, "playback-worklet");
      this.playbackNode.connect(audioContext.destination);
    }
  }

  play(buffer: Int16Array) {
    if (this.playbackNode) {
      this.playbackNode.port.postMessage(buffer);
    }
  }

  clear() {
    if (this.playbackNode) {
      this.playbackNode.port.postMessage(null);
    }
  }
}

export class Recorder {
  onDataAvailable: (buffer: ArrayBuffer) => void;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;

  public constructor(onDataAvailable: (buffer: ArrayBuffer) => void) {
    this.onDataAvailable = onDataAvailable;
  }

  async start(stream: MediaStream) {
    try {
      this.audioContext = new AudioContext({ latencyHint: "interactive",  sampleRate: 24000, });
      await this.audioContext.audioWorklet.addModule(
        "./record-worklet.js",
      );
      this.mediaStream = stream;
      this.mediaStreamSource = this.audioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "recorder-worklet",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: {
            sampleRate: this.audioContext.sampleRate,
          },
        }
      );
      this.workletNode.port.onmessage = (event) => {
        this.onDataAvailable(event.data.buffer);
      };
      this.mediaStreamSource.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);
    } catch (error) {
      this.stop();
    }
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
