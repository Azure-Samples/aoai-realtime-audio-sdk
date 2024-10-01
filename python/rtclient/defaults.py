# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.


from rtclient.models import AudioFormat, ServerVAD, TurnDetection, Voice

DEFAULT_CONVERSATION: str = "default"
DEFAULT_TEMPERATURE: float = 0.6
DEFAULT_VOICE: Voice = "alloy"
DEFAULT_AUDIO_FORMAT: AudioFormat = "pcm16"
DEFAULT_VAD_THRESHOLD: float = 0.5
DEFAULT_VAD_PREFIX_PADDING_MS: int = 300
DEFAULT_VAD_SILENCE_DURATION_MS: int = 200
DEFAULT_TURN_DETECTION: TurnDetection = ServerVAD(
    threshold=DEFAULT_VAD_THRESHOLD,
    prefix_padding_ms=DEFAULT_VAD_PREFIX_PADDING_MS,
    silence_duration_ms=DEFAULT_VAD_SILENCE_DURATION_MS,
)
