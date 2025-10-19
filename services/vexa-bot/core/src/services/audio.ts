import { log } from "../utils";

export interface AudioProcessorConfig {
  targetSampleRate: number;
  bufferSize: number;
  inputChannels: number;
  outputChannels: number;
}

export interface AudioProcessor {
  audioContext: AudioContext;
  destinationNode: MediaStreamAudioDestinationNode;
  recorder: ScriptProcessorNode;
  mediaStream: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  sessionAudioStartTimeMs: number | null;
}

export class AudioService {
  private config: AudioProcessorConfig;
  private processor: AudioProcessor | null = null;

  constructor(config?: Partial<AudioProcessorConfig>) {
    this.config = {
      targetSampleRate: 16000,
      bufferSize: 4096,
      inputChannels: 1,
      outputChannels: 1,
      ...config,
    };
  }

  /**
   * Find active media elements with audio tracks
   */
  async findMediaElements(
    retries: number = 5,
    delay: number = 2000
  ): Promise<HTMLMediaElement[]> {
    log(
      `[AudioService] Starting media element discovery (max retries: ${retries})`
    );

    for (let i = 0; i < retries; i++) {
      const allMediaElements = Array.from(
        document.querySelectorAll("audio, video")
      );
      log(
        `[AudioService] Found ${
          allMediaElements.length
        } total media elements on attempt ${i + 1}`
      );

      // Log details about each media element
      allMediaElements.forEach((el, idx) => {
        const hasSrcObject = el.srcObject instanceof MediaStream;
        const audioTracks = hasSrcObject
          ? el.srcObject.getAudioTracks().length
          : 0;
        const isPaused = el.paused;
        const tagName = el.tagName.toLowerCase();
        log(
          `[AudioService] Media element ${
            idx + 1
          }: ${tagName}, paused: ${isPaused}, has MediaStream: ${hasSrcObject}, audio tracks: ${audioTracks}`
        );
      });

      const mediaElements = allMediaElements.filter(
        (el: any) =>
          !el.paused &&
          el.srcObject instanceof MediaStream &&
          el.srcObject.getAudioTracks().length > 0
      ) as HTMLMediaElement[];

      if (mediaElements.length > 0) {
        log(
          `[AudioService] ✅ Found ${
            mediaElements.length
          } active media elements with audio tracks after ${i + 1} attempt(s)`
        );

        // Log detailed info about active elements
        mediaElements.forEach((el, idx) => {
          const stream = el.srcObject as MediaStream;
          const audioTracks = stream.getAudioTracks();
          const videoTracks = stream.getVideoTracks();
          log(
            `[AudioService] Active element ${idx + 1}: ${
              audioTracks.length
            } audio tracks, ${videoTracks.length} video tracks, readyState: ${
              el.readyState
            }`
          );
        });

        return mediaElements;
      }

      log(
        `[AudioService] ⚠️ No active media elements found on attempt ${
          i + 1
        }/${retries}. Retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    log(
      `[AudioService] ❌ Failed to find active media elements after ${retries} attempts`
    );
    return [];
  }

  /**
   * Create combined audio stream from multiple media elements
   */
  async createCombinedAudioStream(
    mediaElements: HTMLMediaElement[]
  ): Promise<MediaStream> {
    if (mediaElements.length === 0) {
      log(
        `[AudioService] ❌ No media elements provided for audio stream creation`
      );
      throw new Error("No media elements provided for audio stream creation");
    }

    log(
      `[AudioService] 🔄 Creating combined audio stream from ${mediaElements.length} media elements`
    );
    const audioContext = new AudioContext();
    log(
      `[AudioService] Created AudioContext with sample rate: ${audioContext.sampleRate}Hz`
    );

    const destinationNode = audioContext.createMediaStreamDestination();
    let sourcesConnected = 0;
    let sourcesFailed = 0;

    // Connect all media elements to the destination node
    mediaElements.forEach((element: any, index: number) => {
      try {
        log(
          `[AudioService] Processing media element ${index + 1}/${
            mediaElements.length
          }`
        );

        const elementStream =
          element.srcObject ||
          (element.captureStream && element.captureStream()) ||
          (element.mozCaptureStream && element.mozCaptureStream());

        if (!elementStream) {
          log(
            `[AudioService] ❌ Element ${
              index + 1
            }: No stream available (srcObject or captureStream)`
          );
          sourcesFailed++;
          return;
        }

        if (!(elementStream instanceof MediaStream)) {
          log(
            `[AudioService] ❌ Element ${
              index + 1
            }: Stream is not a MediaStream (${typeof elementStream})`
          );
          sourcesFailed++;
          return;
        }

        const audioTracks = elementStream.getAudioTracks();
        if (audioTracks.length === 0) {
          log(
            `[AudioService] ❌ Element ${index + 1}: No audio tracks in stream`
          );
          sourcesFailed++;
          return;
        }

        log(
          `[AudioService] ✅ Element ${index + 1}: Creating source node from ${
            audioTracks.length
          } audio tracks`
        );

        const sourceNode = audioContext.createMediaStreamSource(elementStream);
        sourceNode.connect(destinationNode);
        sourcesConnected++;

        log(
          `[AudioService] ✅ Connected audio stream from element ${index + 1}/${
            mediaElements.length
          } (${sourcesConnected} total connected)`
        );
      } catch (error: any) {
        log(
          `[AudioService] ❌ Could not connect element ${index + 1}: ${
            error.message
          }`
        );
        sourcesFailed++;
      }
    });

    log(
      `[AudioService] Connection summary: ${sourcesConnected} connected, ${sourcesFailed} failed`
    );

    if (sourcesConnected === 0) {
      log(
        `[AudioService] ❌ Could not connect any audio streams. Check media permissions and ensure audio is playing.`
      );
      throw new Error(
        "Could not connect any audio streams. Check media permissions."
      );
    }

    const finalStream = destinationNode.stream;
    const finalAudioTracks = finalStream.getAudioTracks();
    log(
      `[AudioService] ✅ Successfully combined ${sourcesConnected} audio streams into final stream with ${finalAudioTracks.length} audio tracks`
    );

    return finalStream;
  }

  /**
   * Initialize audio processing pipeline
   */
  async initializeAudioProcessor(
    combinedStream: MediaStream
  ): Promise<AudioProcessor> {
    log(
      `[AudioService] 🔄 Initializing audio processor with buffer size: ${this.config.bufferSize}, target sample rate: ${this.config.targetSampleRate}Hz`
    );

    const audioContext = new AudioContext();
    log(
      `[AudioService] Created new AudioContext with sample rate: ${audioContext.sampleRate}Hz`
    );

    const destinationNode = audioContext.createMediaStreamDestination();
    log(`[AudioService] Created MediaStreamAudioDestinationNode`);

    const mediaStream = audioContext.createMediaStreamSource(combinedStream);
    log(
      `[AudioService] Created MediaStreamAudioSourceNode from combined stream`
    );

    const recorder = audioContext.createScriptProcessor(
      this.config.bufferSize,
      this.config.inputChannels,
      this.config.outputChannels
    );
    log(
      `[AudioService] Created ScriptProcessorNode with buffer size: ${this.config.bufferSize}, input channels: ${this.config.inputChannels}, output channels: ${this.config.outputChannels}`
    );

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0; // Silent playback
    log(`[AudioService] Created GainNode with gain set to 0 (muted playback)`);

    // Connect the audio processing pipeline
    mediaStream.connect(recorder);
    recorder.connect(gainNode);
    gainNode.connect(audioContext.destination);
    log(
      `[AudioService] ✅ Audio processing pipeline connected: MediaStreamSource -> ScriptProcessor -> GainNode -> AudioContext.destination`
    );

    this.processor = {
      audioContext,
      destinationNode,
      recorder,
      mediaStream,
      gainNode,
      sessionAudioStartTimeMs: null,
    };

    log(
      `[AudioService] ✅ Audio processing pipeline initialized and ready for audio data`
    );
    return this.processor;
  }

  /**
   * Setup audio data processing callback
   */
  setupAudioDataProcessor(
    onAudioData: (
      audioData: Float32Array,
      sessionStartTime: number | null
    ) => void
  ): void {
    if (!this.processor) {
      log(
        `[AudioService] ❌ Cannot setup audio data processor: Audio processor not initialized`
      );
      throw new Error("Audio processor not initialized");
    }

    log(`[AudioService] 🔄 Setting up audio data processing callback`);

    this.processor.recorder.onaudioprocess = async (event) => {
      try {
        // Set session start time on first audio chunk
        if (this.processor!.sessionAudioStartTimeMs === null) {
          this.processor!.sessionAudioStartTimeMs = Date.now();
          log(
            `[AudioService] 🎯 Session audio start time set: ${
              this.processor!.sessionAudioStartTimeMs
            } (${new Date(
              this.processor!.sessionAudioStartTimeMs
            ).toISOString()})`
          );
        }

        const inputData = event.inputBuffer.getChannelData(0);
        const inputLength = inputData.length;
        const sourceSampleRate = this.processor!.audioContext.sampleRate;

        log(
          `[AudioService] 🎤 Received audio chunk: ${inputLength} samples at ${sourceSampleRate}Hz (${(
            (inputLength / sourceSampleRate) *
            1000
          ).toFixed(1)}ms duration)`
        );

        // Calculate audio levels for debugging
        let maxAmplitude = 0;
        let rmsAmplitude = 0;
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.abs(inputData[i]);
          maxAmplitude = Math.max(maxAmplitude, sample);
          rmsAmplitude += sample * sample;
        }
        rmsAmplitude = Math.sqrt(rmsAmplitude / inputData.length);

        log(
          `[AudioService] 📊 Audio levels: max=${maxAmplitude.toFixed(
            4
          )}, RMS=${rmsAmplitude.toFixed(4)}, hasAudio=${
            rmsAmplitude > 0.001 ? "YES" : "NO"
          }`
        );

        const resampledData = this.resampleAudioData(
          inputData,
          sourceSampleRate
        );
        log(
          `[AudioService] 🔄 Resampled from ${inputLength} to ${resampledData.length} samples (${this.config.targetSampleRate}Hz target)`
        );

        onAudioData(resampledData, this.processor!.sessionAudioStartTimeMs);
      } catch (error: any) {
        log(
          `[AudioService] ❌ Error in audio processing callback: ${error.message}`
        );
      }
    };

    log(`[AudioService] ✅ Audio data processing callback setup complete`);
  }

  /**
   * Resample audio data to target sample rate
   */
  private resampleAudioData(
    inputData: Float32Array,
    sourceSampleRate: number
  ): Float32Array {
    const targetLength = Math.round(
      inputData.length * (this.config.targetSampleRate / sourceSampleRate)
    );

    log(
      `[AudioService] 🔄 Resampling: ${inputData.length} samples @ ${sourceSampleRate}Hz -> ${targetLength} samples @ ${this.config.targetSampleRate}Hz`
    );

    const resampledData = new Float32Array(targetLength);
    const springFactor = (inputData.length - 1) / (targetLength - 1);

    resampledData[0] = inputData[0];
    resampledData[targetLength - 1] = inputData[inputData.length - 1];

    for (let i = 1; i < targetLength - 1; i++) {
      const index = i * springFactor;
      const leftIndex = Math.floor(index);
      const rightIndex = Math.ceil(index);
      const fraction = index - leftIndex;
      resampledData[i] =
        inputData[leftIndex] +
        (inputData[rightIndex] - inputData[leftIndex]) * fraction;
    }

    return resampledData;
  }

  /**
   * Get session audio start time
   */
  getSessionAudioStartTime(): number | null {
    const time = this.processor?.sessionAudioStartTimeMs || null;
    if (time) {
      log(
        `[AudioService] 📅 Retrieved session audio start time: ${time} (${new Date(
          time
        ).toISOString()})`
      );
    } else {
      log(`[AudioService] 📅 Session audio start time not set yet`);
    }
    return time;
  }

  /**
   * Set session audio start time
   */
  setSessionAudioStartTime(timeMs: number): void {
    if (this.processor) {
      this.processor.sessionAudioStartTimeMs = timeMs;
      log(
        `[AudioService] 📅 Manually set session audio start time: ${timeMs} (${new Date(
          timeMs
        ).toISOString()})`
      );
    } else {
      log(
        `[AudioService] ⚠️ Cannot set session audio start time: Audio processor not initialized`
      );
    }
  }

  /**
   * Disconnect audio processing pipeline
   */
  disconnect(): void {
    if (this.processor) {
      log(`[AudioService] 🔌 Disconnecting audio processing pipeline`);
      try {
        this.processor.recorder.disconnect();
        this.processor.mediaStream.disconnect();
        this.processor.gainNode.disconnect();
        this.processor.audioContext.close();
        log(
          `[AudioService] ✅ Audio processing pipeline disconnected successfully`
        );
      } catch (error: any) {
        log(
          `[AudioService] ❌ Error disconnecting audio pipeline: ${error.message}`
        );
      }
      this.processor = null;
    } else {
      log(
        `[AudioService] ⚠️ Cannot disconnect: Audio processor not initialized`
      );
    }
  }

  /**
   * Check if audio processor is initialized
   */
  isInitialized(): boolean {
    return this.processor !== null;
  }

  /**
   * Get audio context
   */
  getAudioContext(): AudioContext | null {
    return this.processor?.audioContext || null;
  }

  /**
   * Get current audio configuration
   */
  getConfig(): AudioProcessorConfig {
    return { ...this.config };
  }

  /**
   * Update audio configuration
   */
  updateConfig(newConfig: Partial<AudioProcessorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}
