import { BotConfig } from "../../types";

export type TranscriptionConfigUpdate = {
  language?: string | null;
  task?: string | null;
};

export type AudioChunkPayload = {
  samples: number[];
  sampleRate: number;
  sessionStartTime: number | null;
};

export type SpeakerEventPayload = {
  eventType: string;
  participantName: string;
  participantId: string;
  relativeTimestampMs: number;
};

export interface TranscriptionService {
  readonly botConfig: BotConfig;
  getSessionUid(): string | null;
  updateConfig(update: TranscriptionConfigUpdate): Promise<void>;
  handleAudioChunk(chunk: AudioChunkPayload): Promise<void>;
  handleSpeakerEvent(event: SpeakerEventPayload): Promise<void>;
  handleSessionControl(event: string): Promise<void>;
  shutdown(reason?: string): Promise<void>;
}
