/**
 * Browser context utilities and services
 * These classes run inside page.evaluate() browser context
 */

/**
 * Generate UUID for browser context
 */
export function generateBrowserUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  } else {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0,
          v = c == "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }
}

/**
 * Browser-compatible AudioService for browser context
 */
export class BrowserAudioService {
  private config: any;
  private processor: any = null;
  private audioContext: AudioContext | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  constructor(config: any) {
    this.config = config;
  }

  async findMediaElements(retries: number = 5, delay: number = 2000): Promise<HTMLMediaElement[]> {
    for (let i = 0; i < retries; i++) {
      const mediaElements = Array.from(
        document.querySelectorAll("audio, video")
      ).filter((el: any) => 
        !el.paused && 
        el.srcObject instanceof MediaStream && 
        el.srcObject.getAudioTracks().length > 0
      ) as HTMLMediaElement[];

      if (mediaElements.length > 0) {
        (window as any).logBot(`Found ${mediaElements.length} active media elements with audio tracks after ${i + 1} attempt(s).`);
        return mediaElements;
      }
      (window as any).logBot(`[Audio] No active media elements found. Retrying in ${delay}ms... (Attempt ${i + 2}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return [];
  }

  async createCombinedAudioStream(mediaElements: HTMLMediaElement[]): Promise<MediaStream> {
    if (mediaElements.length === 0) {
      throw new Error("No media elements provided for audio stream creation");
    }

    (window as any).logBot(`Found ${mediaElements.length} active media elements.`);
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (!this.destinationNode) {
      this.destinationNode = this.audioContext.createMediaStreamDestination();
    }
    let sourcesConnected = 0;

    // Connect all media elements to the destination node
    mediaElements.forEach((element: any, index: number) => {
      try {
        // Ensure element is actually audible
        if (typeof element.muted === "boolean") element.muted = false;
        if (typeof element.volume === "number") element.volume = 1.0;
        if (typeof element.play === "function") {
          element.play().catch(() => {});
        }

        const elementStream =
          element.srcObject ||
          (element.captureStream && element.captureStream()) ||
          (element.mozCaptureStream && element.mozCaptureStream());

        // Debug audio tracks and unmute them
        if (elementStream instanceof MediaStream) {
          const audioTracks = elementStream.getAudioTracks();
          (window as any).logBot(`Element ${index + 1}: Found ${audioTracks.length} audio tracks`);
          audioTracks.forEach((track, trackIndex) => {
            (window as any).logBot(`  Track ${trackIndex}: enabled=${track.enabled}, muted=${track.muted}, label=${track.label}`);
            
            // Unmute muted audio tracks
            if (track.muted) {
              track.enabled = true;
              // Force unmute by setting muted to false
              try {
                (track as any).muted = false;
                (window as any).logBot(`  Unmuted track ${trackIndex} (enabled=${track.enabled}, muted=${track.muted})`);
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                (window as any).logBot(`  Could not unmute track ${trackIndex}: ${message}`);
              }
            }
          });
        }

        if (
          elementStream instanceof MediaStream &&
          elementStream.getAudioTracks().length > 0
        ) {
          // Connect regardless of the read-only muted flag; WebAudio can still pull samples
          const sourceNode = this.audioContext!.createMediaStreamSource(elementStream);
          sourceNode.connect(this.destinationNode!);
          sourcesConnected++;
          (window as any).logBot(`Connected audio stream from element ${index + 1}/${mediaElements.length}. Tracks=${elementStream.getAudioTracks().length}`);
        } else {
          (window as any).logBot(`Skipping element ${index + 1}: No audio tracks found`);
        }
      } catch (error: any) {
        (window as any).logBot(`Could not connect element ${index + 1}: ${error.message}`);
      }
    });

    if (sourcesConnected === 0) {
      throw new Error("Could not connect any audio streams. Check media permissions.");
    }

    (window as any).logBot(`Successfully combined ${sourcesConnected} audio streams.`);
    return this.destinationNode!.stream;
  }

  async initializeAudioProcessor(combinedStream: MediaStream): Promise<any> {
    // Reuse existing context if available
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (!this.destinationNode) {
      this.destinationNode = this.audioContext.createMediaStreamDestination();
    }

    const mediaStream = this.audioContext.createMediaStreamSource(combinedStream);
    const recorder = this.audioContext.createScriptProcessor(
      this.config.bufferSize,
      this.config.inputChannels,
      this.config.outputChannels
    );
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0; // Silent playback

    // Connect the audio processing pipeline
    mediaStream.connect(recorder);
    recorder.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    this.processor = {
      audioContext: this.audioContext,
      destinationNode: this.destinationNode,
      recorder,
      mediaStream,
      gainNode,
      sessionAudioStartTimeMs: null
    };

    try { await this.audioContext.resume(); } catch {}
    (window as any).logBot("Audio processing pipeline connected and ready.");
    return this.processor;
  }

  setupAudioDataProcessor(onAudioData: (audioData: Float32Array, sessionStartTime: number | null) => void): void {
    if (!this.processor) {
      throw new Error("Audio processor not initialized");
    }

    this.processor.recorder.onaudioprocess = async (event: any) => {
      // Set session start time on first audio chunk
      if (this.processor!.sessionAudioStartTimeMs === null) {
        this.processor!.sessionAudioStartTimeMs = Date.now();
        (window as any).logBot(`[Audio] Session audio start time set: ${this.processor!.sessionAudioStartTimeMs}`);
      }

      const inputData = event.inputBuffer.getChannelData(0);
      const resampledData = this.resampleAudioData(inputData, this.processor!.audioContext.sampleRate);
      
      onAudioData(resampledData, this.processor!.sessionAudioStartTimeMs);
    };
  }

  private resampleAudioData(inputData: Float32Array, sourceSampleRate: number): Float32Array {
    const targetLength = Math.round(
      inputData.length * (this.config.targetSampleRate / sourceSampleRate)
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

  getSessionAudioStartTime(): number | null {
    return this.processor?.sessionAudioStartTimeMs || null;
  }

  disconnect(): void {
    if (this.processor) {
      try {
        this.processor.recorder.disconnect();
        this.processor.mediaStream.disconnect();
        this.processor.gainNode.disconnect();
        this.processor.audioContext.close();
        (window as any).logBot("Audio processing pipeline disconnected.");
      } catch (error: any) {
        (window as any).logBot(`Error disconnecting audio pipeline: ${error.message}`);
      }
      this.processor = null;
    }
  }
}


