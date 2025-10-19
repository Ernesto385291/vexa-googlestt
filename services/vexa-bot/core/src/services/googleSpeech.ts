import { protos, SpeechClient } from "@google-cloud/speech";
import { v4 as uuidv4 } from "uuid";
import { Duplex } from "stream";
import { createClient, RedisClientType } from "redis";

import { log } from "../utils";
import { BotConfig } from "../types";
import {
  AudioChunkPayload,
  SpeakerEventPayload,
  TranscriptionConfigUpdate,
  TranscriptionService,
} from "./transcription/types";

const DEFAULT_SAMPLE_RATE = 16000;

const { RecognitionConfig } = protos.google.cloud.speech.v1;

type StreamingRecognizeResponse =
  protos.google.cloud.speech.v1.IStreamingRecognizeResponse;
type StreamingRecognitionResult =
  protos.google.cloud.speech.v1.IStreamingRecognitionResult;
type WordInfo = protos.google.cloud.speech.v1.IWordInfo;
type Duration = protos.google.protobuf.IDuration;
type SpeechClientOptions = ConstructorParameters<typeof SpeechClient>[0];

interface GoogleCredentialsJSON {
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

export class GoogleSpeechService implements TranscriptionService {
  public readonly botConfig: BotConfig;

  private speechClient: SpeechClient | null = null;
  private recognizeStream: Duplex | null = null;
  private redisClient: RedisClientType | null = null;

  private readonly sessionUid: string;
  private sessionStartTimeMs: number | null = null;
  private sessionStartPublished = false;
  private sessionEndPublished = false;

  private transcriptionStreamName: string;
  private speakerEventsStreamName: string;

  private language: string;
  private task: string;
  private streamSampleRate = DEFAULT_SAMPLE_RATE;

  private shuttingDown = false;
  private streamReady = false;
  private lastPublishedEndSeconds = 0;

  constructor(botConfig: BotConfig) {
    this.botConfig = botConfig;
    this.sessionUid = uuidv4();
    this.language = this.normalizeLanguage(botConfig.language);
    this.task = botConfig.task || "transcribe";
    this.transcriptionStreamName =
      process.env.REDIS_STREAM_NAME || "transcription_segments";
    this.speakerEventsStreamName =
      process.env.REDIS_SPEAKER_EVENTS_STREAM_NAME || "speaker_events_relative";
  }

  async initialize(): Promise<void> {
    await this.initializeRedisClient();
    await this.initializeSpeechClient();
  }

  getSessionUid(): string | null {
    return this.sessionUid;
  }

  async updateConfig(update: TranscriptionConfigUpdate): Promise<void> {
    const nextLanguage = this.normalizeLanguage(
      update.language ?? this.language
    );
    const nextTask = update.task ? update.task : this.task;

    const languageChanged = nextLanguage !== this.language;
    const taskChanged = nextTask !== this.task;

    this.language = nextLanguage;
    this.task = nextTask;

    if ((languageChanged || taskChanged) && !this.shuttingDown) {
      log(
        `[GoogleSpeechService] Updating configuration: language=${this.language}, task=${this.task}`
      );
      await this.restartStream();
    }
  }

  async handleAudioChunk(chunk: AudioChunkPayload): Promise<void> {
    if (this.shuttingDown) {
      log(
        `[GoogleSpeechService] ⚠️ Ignoring audio chunk: service is shutting down`
      );
      return;
    }

    log(
      `[GoogleSpeechService] 🎤 Received audio chunk: ${chunk.samples.length} samples @ ${chunk.sampleRate}Hz, sessionStartTime: ${chunk.sessionStartTime}`
    );

    if (!this.redisClient) {
      log(
        `[GoogleSpeechService] 🔄 Initializing Redis client for audio chunk processing`
      );
      await this.initializeRedisClient();
    }

    if (chunk.sampleRate !== this.streamSampleRate) {
      log(
        `[GoogleSpeechService] 🔄 Sample rate changed from ${this.streamSampleRate}Hz to ${chunk.sampleRate}Hz, restarting stream`
      );
      this.streamSampleRate = chunk.sampleRate;
      await this.restartStream();
    }

    if (!this.speechClient || !this.recognizeStream || !this.streamReady) {
      log(
        `[GoogleSpeechService] 🔄 Ensuring STT stream is ready (client: ${!!this
          .speechClient}, stream: ${!!this.recognizeStream}, ready: ${
          this.streamReady
        })`
      );
      await this.ensureStream();
    }

    if (chunk.sessionStartTime !== null && this.sessionStartTimeMs === null) {
      this.sessionStartTimeMs = chunk.sessionStartTime;
      log(
        `[GoogleSpeechService] 🎯 Session start time set: ${
          this.sessionStartTimeMs
        } (${new Date(this.sessionStartTimeMs).toISOString()})`
      );
      await this.publishSessionStart();
    }

    const buffer = this.convertFloat32ToLinear16(chunk.samples);
    if (!buffer) {
      log(
        `[GoogleSpeechService] ❌ Failed to convert audio samples to Linear16 buffer`
      );
      return;
    }

    if (!this.recognizeStream) {
      log(
        `[GoogleSpeechService] ❌ No recognition stream available to write audio chunk`
      );
      return;
    }

    log(
      `[GoogleSpeechService] 📤 Sending ${buffer.length} bytes of Linear16 PCM audio to Google STT`
    );

    try {
      this.recognizeStream.write({ audioContent: buffer });
      log(
        `[GoogleSpeechService] ✅ Audio chunk successfully sent to Google STT`
      );
    } catch (error: any) {
      log(
        `[GoogleSpeechService] ❌ Failed to write audio chunk: ${
          error?.message || error
        }`
      );
      await this.restartStream();
    }
  }

  async handleSpeakerEvent(event: SpeakerEventPayload): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    const payload = {
      uid: this.sessionUid,
      token: this.botConfig.token,
      platform: this.botConfig.platform,
      meeting_id: this.botConfig.nativeMeetingId,
      meeting_url: this.botConfig.meetingUrl || undefined,
      event_type: event.eventType,
      participant_name: event.participantName,
      participant_id_meet: event.participantId,
      relative_client_timestamp_ms: event.relativeTimestampMs,
      server_received_timestamp_iso: new Date().toISOString(),
    } as Record<string, any>;

    try {
      await this.redisClient.xAdd(
        this.speakerEventsStreamName,
        "*",
        this.stringifyValues(payload)
      );
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Failed to publish speaker event: ${
          error?.message || error
        }`
      );
    }
  }

  async handleSessionControl(event: string): Promise<void> {
    const normalized = event?.toUpperCase?.() || "";
    if (normalized === "LEAVING_MEETING" || normalized === "END_SESSION") {
      await this.publishSessionEnd();
    }
  }

  async shutdown(reason?: string): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    log(
      `[GoogleSpeechService] Shutting down transcription pipeline${
        reason ? ` (${reason})` : ""
      }`
    );

    await this.publishSessionEnd();
    this.closeRecognizeStream();

    try {
      if (this.speechClient) {
        await this.speechClient.close();
      }
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Error closing SpeechClient: ${
          error?.message || error
        }`
      );
    } finally {
      this.speechClient = null;
    }

    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch (error: any) {
        log(
          `[GoogleSpeechService] Error closing Redis client: ${
            error?.message || error
          }`
        );
      } finally {
        this.redisClient = null;
      }
    }
  }

  // --- Internal helpers --------------------------------------------------

  private async initializeRedisClient(): Promise<void> {
    if (this.redisClient) {
      return;
    }

    if (!this.botConfig.redisUrl) {
      log(
        "[GoogleSpeechService] Missing Redis URL in bot config; transcription will be disabled"
      );
      return;
    }

    this.redisClient = createClient({ url: this.botConfig.redisUrl });
    this.redisClient.on("error", (err) => {
      log(`[GoogleSpeechService] Redis error: ${err.message}`);
    });

    try {
      await this.redisClient.connect();
      log(
        "[GoogleSpeechService] Connected to Redis for transcription publishing"
      );
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Failed to connect to Redis: ${
          error?.message || error
        }`
      );
      this.redisClient = null;
    }
  }

  private async initializeSpeechClient(): Promise<void> {
    if (this.speechClient) {
      return;
    }

    const options = this.buildSpeechClientOptions();

    try {
      this.speechClient = options
        ? new SpeechClient(options)
        : new SpeechClient();
      log("[GoogleSpeechService] Google Speech client initialized");
      await this.ensureStream();
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Failed to initialize Google Speech client: ${
          error?.message || error
        }`
      );
      this.speechClient = null;
    }
  }

  private buildSpeechClientOptions(): SpeechClientOptions | undefined {
    const options: SpeechClientOptions = {};

    const explicitProjectId =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT_ID;
    if (explicitProjectId) {
      options.projectId = explicitProjectId;
    }

    const credentials = this.resolveCredentialsFromEnv();
    if (credentials) {
      options.credentials = credentials;
      if (!options.projectId && credentials.project_id) {
        options.projectId = credentials.project_id;
      }
    }

    return Object.keys(options).length ? options : undefined;
  }

  private resolveCredentialsFromEnv(): GoogleCredentialsJSON | undefined {
    const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64;
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    let parsed: GoogleCredentialsJSON | null = null;

    if (b64) {
      try {
        const json = Buffer.from(b64, "base64").toString("utf8");
        parsed = JSON.parse(json);
      } catch (error: any) {
        log(
          `[GoogleSpeechService] Failed to decode GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: ${
            error?.message || error
          }`
        );
      }
    } else if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (error: any) {
        log(
          `[GoogleSpeechService] Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${
            error?.message || error
          }`
        );
      }
    }

    if (parsed?.client_email && parsed?.private_key) {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        project_id: parsed.project_id,
      };
    }

    return undefined;
  }

  private async ensureStream(): Promise<void> {
    if (this.shuttingDown) {
      log(
        `[GoogleSpeechService] ⚠️ Cannot ensure stream: service is shutting down`
      );
      return;
    }

    log(
      `[GoogleSpeechService] 🔄 Ensuring STT stream is ready (language: ${this.language}, sampleRate: ${this.streamSampleRate}Hz, task: ${this.task})`
    );

    if (!this.speechClient) {
      log(`[GoogleSpeechService] 🔄 Initializing speech client`);
      await this.initializeSpeechClient();
      if (!this.speechClient) {
        log(`[GoogleSpeechService] ❌ Failed to initialize speech client`);
        return;
      }
    }

    log(`[GoogleSpeechService] 🔄 Closing any existing recognition stream`);
    this.closeRecognizeStream();

    try {
      const request = {
        config: {
          encoding: RecognitionConfig.AudioEncoding.LINEAR16,
          sampleRateHertz: this.streamSampleRate,
          languageCode: this.language,
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
        },
        interimResults: true,
      };

      log(
        `[GoogleSpeechService] 📡 Creating streaming recognition request: encoding=LINEAR16, sampleRate=${this.streamSampleRate}Hz, language=${this.language}, interimResults=true`
      );

      if (this.task === "translate") {
        // Google Speech-to-Text does not support translation natively; log once.
        log(
          "[GoogleSpeechService] ⚠️ Task 'translate' requested, but Google STT only provides transcription. Proceeding with transcription."
        );
      }

      log(
        `[GoogleSpeechService] 🔌 Establishing streaming connection to Google STT`
      );
      this.recognizeStream = this.speechClient
        .streamingRecognize(request)
        .on("data", (data: StreamingRecognizeResponse) =>
          this.handleStreamingData(data)
        )
        .on("error", (err: Error) => this.handleStreamingError(err))
        .on("end", () => this.handleStreamingEnd());

      this.streamReady = true;
      log(
        `[GoogleSpeechService] ✅ Streaming recognition connection established successfully`
      );
    } catch (error: any) {
      log(
        `[GoogleSpeechService] ❌ Failed to establish streaming recognition: ${
          error?.message || error
        }`
      );
      this.recognizeStream = null;
      this.streamReady = false;
    }
  }

  private async restartStream(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.streamReady = false;
    this.closeRecognizeStream();
    await this.ensureStream();
  }

  private closeRecognizeStream(): void {
    if (!this.recognizeStream) {
      return;
    }

    try {
      this.recognizeStream.removeAllListeners();
      this.recognizeStream.end?.();
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Error while closing recognition stream: ${
          error?.message || error
        }`
      );
    } finally {
      this.recognizeStream = null;
      this.streamReady = false;
    }
  }

  private async publishSessionStart(): Promise<void> {
    if (!this.redisClient || this.sessionStartPublished) {
      return;
    }

    const start = this.sessionStartTimeMs ?? Date.now();
    const payload = {
      type: "session_start",
      token: this.botConfig.token,
      platform: this.botConfig.platform,
      meeting_id: this.botConfig.nativeMeetingId,
      uid: this.sessionUid,
      start_timestamp: new Date(start).toISOString(),
    };

    try {
      await this.redisClient.xAdd(this.transcriptionStreamName, "*", {
        payload: JSON.stringify(payload),
      });
      this.sessionStartPublished = true;
      log(
        `[GoogleSpeechService] Session start published for ${this.sessionUid}`
      );
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Failed to publish session_start: ${
          error?.message || error
        }`
      );
    }
  }

  private async publishSessionEnd(): Promise<void> {
    if (!this.redisClient || this.sessionEndPublished) {
      return;
    }

    const payload = {
      type: "session_end",
      token: this.botConfig.token,
      platform: this.botConfig.platform,
      meeting_id: this.botConfig.nativeMeetingId,
      uid: this.sessionUid,
      end_timestamp: new Date().toISOString(),
    };

    try {
      await this.redisClient.xAdd(this.transcriptionStreamName, "*", {
        payload: JSON.stringify(payload),
      });
      this.sessionEndPublished = true;
      log(`[GoogleSpeechService] Session end published for ${this.sessionUid}`);
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Failed to publish session_end: ${
          error?.message || error
        }`
      );
    }
  }

  private handleStreamingData(response: StreamingRecognizeResponse): void {
    if (!response) {
      log(
        `[GoogleSpeechService] ⚠️ Received null/undefined streaming response`
      );
      return;
    }

    if (!response.results) {
      log(`[GoogleSpeechService] ⚠️ Streaming response has no results array`);
      return;
    }

    if (!this.redisClient) {
      log(
        `[GoogleSpeechService] ⚠️ No Redis client available, cannot process streaming data`
      );
      return;
    }

    log(
      `[GoogleSpeechService] 📥 Received streaming response with ${response.results.length} result(s)`
    );

    for (let i = 0; i < response.results.length; i++) {
      const result = response.results[i];
      const isFinal = result.isFinal;
      const hasAlternatives =
        result.alternatives && result.alternatives.length > 0;
      const transcript = hasAlternatives
        ? (result.alternatives[0].transcript || "").trim()
        : "";

      log(
        `[GoogleSpeechService] 📝 Processing result ${i + 1}/${
          response.results.length
        }: final=${isFinal}, hasTranscript=${!!transcript}, length=${
          transcript.length
        }`
      );

      this.processRecognitionResult(result);
    }
  }

  private async processRecognitionResult(
    result: StreamingRecognitionResult | null | undefined
  ): Promise<void> {
    if (!result) {
      log(
        `[GoogleSpeechService] ⚠️ Received null/undefined recognition result`
      );
      return;
    }

    if (!result.alternatives || !result.alternatives.length) {
      log(`[GoogleSpeechService] ⚠️ Recognition result has no alternatives`);
      return;
    }

    if (!result.isFinal) {
      log(`[GoogleSpeechService] ⏳ Ignoring interim result (not final)`);
      return;
    }

    const alternative = result.alternatives[0];
    const transcript = (alternative.transcript || "").trim();
    if (!transcript) {
      log(`[GoogleSpeechService] ⚠️ Final result has empty transcript`);
      return;
    }

    log(
      `[GoogleSpeechService] 🎯 Processing final recognition result with transcript: "${transcript.substring(
        0,
        100
      )}${transcript.length > 100 ? "..." : ""}"`
    );

    let startSeconds = this.lastPublishedEndSeconds;
    let endSeconds = this.lastPublishedEndSeconds;

    const words = alternative.words as WordInfo[] | undefined;
    if (words && words.length > 0) {
      const firstWord = words[0];
      const lastWord = words[words.length - 1];
      const computedStart = this.durationToSeconds(firstWord?.startTime);
      const computedEnd = this.durationToSeconds(lastWord?.endTime);

      log(
        `[GoogleSpeechService] 📊 Word-level timing: ${words.length} words, start: ${computedStart}s, end: ${computedEnd}s`
      );

      if (typeof computedStart === "number") {
        startSeconds = computedStart;
      }
      if (typeof computedEnd === "number") {
        endSeconds = computedEnd;
      }
    } else if (result.resultEndTime) {
      const computedEnd = this.durationToSeconds(result.resultEndTime);
      log(`[GoogleSpeechService] 📊 Result-level timing: end: ${computedEnd}s`);
      if (typeof computedEnd === "number") {
        endSeconds = computedEnd;
      }
    } else {
      log(`[GoogleSpeechService] ⚠️ No timing information available in result`);
    }

    if (endSeconds < startSeconds) {
      log(
        `[GoogleSpeechService] ⚠️ End time (${endSeconds}s) < start time (${startSeconds}s), adjusting end time`
      );
      endSeconds = startSeconds;
    }

    const confidence = alternative.confidence ?? undefined;
    log(
      `[GoogleSpeechService] 📈 Transcription confidence: ${
        confidence ? confidence.toFixed(3) : "N/A"
      }`
    );

    const segments = [
      {
        text: transcript,
        start: startSeconds,
        end: endSeconds,
        completed: true,
        confidence: confidence,
        language: this.language,
      },
    ];

    this.lastPublishedEndSeconds = Math.max(
      this.lastPublishedEndSeconds,
      endSeconds
    );

    // Debug: log recognized text (truncated) to help diagnose missing transcripts
    try {
      const preview =
        transcript.length > 120 ? transcript.slice(0, 117) + "..." : transcript;
      log(
        `[GoogleSpeechService] ✅ Final recognized text (${
          this.language
        }): "${preview}" [${startSeconds.toFixed(2)}-${endSeconds.toFixed(2)}]`
      );
    } catch {}

    log(`[GoogleSpeechService] 📤 Publishing transcription segment to Redis`);
    await this.publishTranscriptionSegments(segments);
    log(
      `[GoogleSpeechService] ✅ Transcription segment published successfully`
    );
  }

  private async publishTranscriptionSegments(
    segments: Array<Record<string, any>>
  ): Promise<void> {
    if (!this.redisClient || !segments.length) {
      return;
    }

    const payload = {
      type: "transcription",
      token: this.botConfig.token,
      platform: this.botConfig.platform,
      meeting_id: this.botConfig.nativeMeetingId,
      uid: this.sessionUid,
      segments,
    };

    try {
      await this.redisClient.xAdd(this.transcriptionStreamName, "*", {
        payload: JSON.stringify(payload),
      });
    } catch (error: any) {
      log(
        `[GoogleSpeechService] Failed to publish transcription segments: ${
          error?.message || error
        }`
      );
    }
  }

  private handleStreamingError(error: Error): void {
    if (this.shuttingDown) {
      return;
    }
    log(`[GoogleSpeechService] Streaming error: ${error.message}`);
    this.restartStream().catch((err) => {
      log(
        `[GoogleSpeechService] Failed to restart stream after error: ${
          err?.message || err
        }`
      );
    });
  }

  private handleStreamingEnd(): void {
    if (this.shuttingDown) {
      return;
    }
    log("[GoogleSpeechService] Streaming connection ended; restarting");
    this.restartStream().catch((err) => {
      log(
        `[GoogleSpeechService] Failed to restart stream after end event: ${
          err?.message || err
        }`
      );
    });
  }

  private convertFloat32ToLinear16(samples: number[]): Buffer | null {
    if (!samples || samples.length === 0) {
      return null;
    }

    const buffer = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      let s = samples[i];
      if (s > 1) s = 1;
      if (s < -1) s = -1;
      s = s * 0x7fff;
      buffer.writeInt16LE(Math.round(s), i * 2);
    }
    return buffer;
  }

  private durationToSeconds(
    duration: Duration | null | undefined
  ): number | null {
    if (!duration) {
      return null;
    }
    const seconds = Number(duration.seconds || 0);
    const nanos = Number(duration.nanos || 0);
    return seconds + nanos / 1e9;
  }

  private normalizeLanguage(language: string | null | undefined): string {
    if (!language) {
      return "en-US";
    }
    const trimmed = language.trim();
    if (!trimmed) {
      return "en-US";
    }
    if (trimmed.length === 2) {
      return `${trimmed.toLowerCase()}-${trimmed.toUpperCase()}`;
    }
    return trimmed;
  }

  private stringifyValues(record: Record<string, any>): Record<string, string> {
    return Object.entries(record).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (value === undefined || value === null) {
          return acc;
        }
        if (typeof value === "string") {
          acc[key] = value;
        } else {
          acc[key] = String(value);
        }
        return acc;
      },
      {}
    );
  }
}
