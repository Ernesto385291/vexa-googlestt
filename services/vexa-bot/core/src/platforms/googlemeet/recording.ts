import { Page } from "playwright";
import { log } from "../../utils";
import { BotConfig } from "../../types";
import { GoogleSpeechService } from "../../services/googleSpeech";
import { setTranscriptionService } from "../../services/transcription/registry";
import {
  googleParticipantSelectors,
  googleSpeakingClassNames,
  googleSilenceClassNames,
  googleParticipantContainerSelectors,
  googleNameSelectors,
  googleSpeakingIndicators,
  googlePeopleButtonSelectors
} from "./selectors";

const BROWSER_UTILS_PATH = require('path').join(__dirname, '../../browser-utils.global.js');

async function injectBrowserUtils(page: Page): Promise<void> {
  try {
    await page.addScriptTag({ path: BROWSER_UTILS_PATH });
    return;
  } catch (primaryError: any) {
    log(`Warning: Could not load browser utils via addScriptTag: ${primaryError?.message || primaryError}`);
  }

  const fs = require('fs');
  const path = require('path');
  const scriptPath = path.join(__dirname, '../../browser-utils.global.js');

  const scriptContent = fs.readFileSync(scriptPath, 'utf8');
  await page.evaluate(async (script) => {
    try {
      const injectWithTrustedTypes = () => {
        const policy = (window as any).trustedTypes?.createPolicy('vexaPolicyGoogle', {
          createScript: (s: string) => s,
          createScriptURL: (s: string) => s
        });
        const scriptEl = document.createElement('script');
        if (policy) {
          (scriptEl as any).text = policy.createScript(script);
          document.head.appendChild(scriptEl);
          return true;
        }
        return false;
      };

      const injectWithBlob = async () => {
        const blob = new Blob([script], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        const policy = (window as any).trustedTypes?.createPolicy('vexaPolicyGoogleUrl', {
          createScriptURL: (u: string) => u
        });
        const scriptEl = document.createElement('script');
        const finalUrl = policy ? (policy as any).createScriptURL(url) : url;
        (scriptEl as any).src = finalUrl as any;
        await new Promise<void>((resolve, reject) => {
          scriptEl.onload = () => resolve();
          scriptEl.onerror = () => reject(new Error('Failed to load browser utils via blob URL'));
        });
        document.head.appendChild(scriptEl);
      };

      if (!injectWithTrustedTypes()) {
        await injectWithBlob();
      }
      const utils = (window as any).VexaBrowserUtils;
      if (!utils) {
        throw new Error('VexaBrowserUtils not found after injection');
      }
      console.log('VexaBrowserUtils loaded keys:', Object.keys(utils));
    } catch (error) {
      console.error('Error injecting browser utils script:', (error as any)?.message || error);
      throw error;
    }
  }, scriptContent);
}

type AudioChunkPayload = {
  samples: number[];
  sampleRate: number;
  sessionStartTime: number | null;
};

type SpeakerBridgePayload = {
  eventType: string;
  participantName: string;
  participantId: string;
  relativeTimestampMs: number;
};

type TranscriptionConfigPayload = {
  language?: string | null;
  task?: string | null;
};

type SessionControlPayload = {
  event: string;
};

export async function startGoogleRecording(page: Page, botConfig: BotConfig): Promise<void> {
  const speechService = new GoogleSpeechService(botConfig);
  let serviceRegistered = false;

  try {
    await speechService.initialize();
    await speechService.updateConfig({ language: botConfig.language, task: botConfig.task });
    setTranscriptionService(speechService);
    serviceRegistered = true;

    await page.exposeFunction("vexaSendAudioChunk", async (payload: AudioChunkPayload) => {
      await speechService.handleAudioChunk(payload);
    });

    await page.exposeFunction("vexaSendSpeakerEvent", async (payload: SpeakerBridgePayload) => {
      await speechService.handleSpeakerEvent(payload);
    });

    await page.exposeFunction("vexaUpdateTranscriptionConfig", async (payload: TranscriptionConfigPayload) => {
      await speechService.updateConfig(payload);
    });

    await page.exposeFunction("vexaSignalSessionControl", async (payload: SessionControlPayload) => {
      await speechService.handleSessionControl(payload.event);
    });

    await injectBrowserUtils(page);

    await page.evaluate(
      async (pageArgs: {
        botConfigData: BotConfig;
        selectors: {
          participantSelectors: string[];
          speakingClasses: string[];
          silenceClasses: string[];
          containerSelectors: string[];
          nameSelectors: string[];
          speakingIndicators: string[];
          peopleButtonSelectors: string[];
        };
      }) => {
        const { botConfigData, selectors } = pageArgs;
        const browserUtils = (window as any).VexaBrowserUtils;
        if (!browserUtils) {
          throw new Error('Browser utilities not available in page context');
        }

        const sendAudioChunk = (window as any).vexaSendAudioChunk;
        const sendSpeakerEvent = (window as any).vexaSendSpeakerEvent;
        const updateTranscriptionConfig = (window as any).vexaUpdateTranscriptionConfig;
        const signalSessionControl = (window as any).vexaSignalSessionControl;

        (window as any).__vexaBotConfig = { ...botConfigData };
        (window as any).__vexaPendingReconfigure = null;

        (window as any).triggerWebSocketReconfigure = async (lang: string | null, task: string | null) => {
          const cfg = (window as any).__vexaBotConfig || {};
          cfg.language = lang;
          cfg.task = task || 'transcribe';
          (window as any).__vexaBotConfig = cfg;
          if (typeof updateTranscriptionConfig === 'function') {
            try {
              await updateTranscriptionConfig({ language: cfg.language, task: cfg.task });
              (window as any).logBot?.(`[Reconfigure] Applied config: language=${cfg.language || 'default'}, task=${cfg.task}`);
            } catch (error: any) {
              (window as any).logBot?.(`[Reconfigure] Failed to apply transcription config: ${error?.message || error}`);
            }
          } else {
            (window as any).logBot?.('[Reconfigure] Transcription bridge not ready; update skipped.');
          }
        };

        document.addEventListener('vexa:reconfigure', (ev: Event) => {
          try {
            const detail = (ev as CustomEvent).detail || {};
            (window as any).triggerWebSocketReconfigure(detail.lang, detail.task);
          } catch (error) {
            console.warn('[Reconfigure] Error handling reconfigure event', error);
          }
        });

        const audioService = new browserUtils.BrowserAudioService({
          targetSampleRate: 16000,
          bufferSize: 4096,
          inputChannels: 1,
          outputChannels: 1
        });

        (window as any).logBot?.('Starting Google Meet recording process with Google STT bridge.');

        const mediaElements = await audioService.findMediaElements();
        if (mediaElements.length === 0) {
          throw new Error('[Google Meet BOT Error] No active media elements found after multiple retries. Ensure the Google Meet meeting media is playing.');
        }

        const combinedStream = await audioService.createCombinedAudioStream(mediaElements);
        await audioService.initializeAudioProcessor(combinedStream);

        const sendAudioToHost = (audioData: Float32Array, sessionStartTime: number | null) => {
          if (typeof sendAudioChunk !== 'function') {
            (window as any).logBot?.('[Audio] Transcription bridge unavailable; dropping chunk.');
            return;
          }
          const payload: AudioChunkPayload = {
            samples: Array.from(audioData),
            sampleRate: 16000,
            sessionStartTime
          };
          Promise.resolve(sendAudioChunk(payload)).catch((error: any) => {
            (window as any).logBot?.(`[Audio] Failed to send chunk: ${error?.message || error}`);
          });
        };

        audioService.setupAudioDataProcessor((audioData: Float32Array, sessionStartTime: number | null) => {
          sendAudioToHost(audioData, sessionStartTime);
        });

        const selectorsTyped = selectors as any;
        const speakingStates = new Map<string, string>();

        const getGoogleParticipantId = (element: HTMLElement) => {
          let id = element.getAttribute('data-participant-id');
          if (!id) {
            const stableChild = element.querySelector('[jsinstance]') as HTMLElement | null;
            if (stableChild) {
              id = stableChild.getAttribute('jsinstance') || undefined as any;
            }
          }
          if (!id) {
            if (!(element as any).dataset.vexaGeneratedId) {
              (element as any).dataset.vexaGeneratedId = 'gm-id-' + Math.random().toString(36).substr(2, 9);
            }
            id = (element as any).dataset.vexaGeneratedId;
          }
          return id as string;
        };

        const getGoogleParticipantName = (participantElement: HTMLElement) => {
          const notranslate = participantElement.querySelector('span.notranslate') as HTMLElement | null;
          if (notranslate && notranslate.textContent && notranslate.textContent.trim()) {
            const text = notranslate.textContent.trim();
            if (text.length > 1 && text.length < 50) {
              return text;
            }
          }

          const nameSelectors: string[] = selectorsTyped.nameSelectors || [];
          for (const sel of nameSelectors) {
            const el = participantElement.querySelector(sel) as HTMLElement | null;
            if (el) {
              let nameText = el.textContent || el.innerText || el.getAttribute('data-self-name') || el.getAttribute('aria-label') || '';
              if (nameText) {
                nameText = nameText.trim();
                if (nameText.length > 1 && nameText.length < 50) {
                  return nameText;
                }
              }
            }
          }

          const selfName = participantElement.getAttribute('data-self-name');
          if (selfName && selfName.trim()) {
            return selfName.trim();
          }
          return `Google Participant (${getGoogleParticipantId(participantElement)})`;
        };

        const isVisible = (el: HTMLElement): boolean => {
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const ariaHidden = el.getAttribute('aria-hidden') === 'true';
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            cs.opacity !== '0' &&
            !ariaHidden
          );
        };

        const hasSpeakingIndicator = (container: HTMLElement): boolean => {
          const indicators: string[] = selectorsTyped.speakingIndicators || [];
          for (const sel of indicators) {
            const ind = container.querySelector(sel) as HTMLElement | null;
            if (ind && isVisible(ind)) {
              return true;
            }
          }
          return false;
        };

        const inferSpeakingFromClasses = (container: HTMLElement, mutatedClassList?: DOMTokenList) => {
          const speakingClasses: string[] = selectorsTyped.speakingClasses || [];
          const silenceClasses: string[] = selectorsTyped.silenceClasses || [];

          const classList = mutatedClassList || container.classList;
          const descendantSpeaking = speakingClasses.some((cls) => container.querySelector('.' + cls));
          const hasSpeaking = speakingClasses.some((cls) => classList.contains(cls)) || descendantSpeaking;
          const hasSilent = silenceClasses.some((cls) => classList.contains(cls));
          if (hasSpeaking) {
            return { speaking: true };
          }
          if (hasSilent) {
            return { speaking: false };
          }
          return { speaking: false };
        };

        const sendSpeakerEventToHost = (eventType: string, participantElement: HTMLElement) => {
          if (typeof sendSpeakerEvent !== 'function') {
            return;
          }
          const sessionStartTime = audioService.getSessionAudioStartTime();
          if (sessionStartTime === null) {
            return;
          }
          const participantId = getGoogleParticipantId(participantElement);
          const participantName = getGoogleParticipantName(participantElement);
          const relativeTimestampMs = Date.now() - sessionStartTime;
          const payload: SpeakerBridgePayload = {
            eventType,
            participantName,
            participantId,
            relativeTimestampMs
          };
          Promise.resolve(sendSpeakerEvent(payload)).catch((error: any) => {
            (window as any).logBot?.(`[SpeakerEvent] Failed to send ${eventType}: ${error?.message || error}`);
          });
        };

        const logGoogleSpeakerEvent = (participantElement: HTMLElement, mutatedClassList?: DOMTokenList) => {
          const participantId = getGoogleParticipantId(participantElement);
          const participantName = getGoogleParticipantName(participantElement);
          const previousLogicalState = speakingStates.get(participantId) || 'silent';

          const indicatorSpeaking = hasSpeakingIndicator(participantElement);
          const classInference = inferSpeakingFromClasses(participantElement, mutatedClassList);
          const isCurrentlySpeaking = indicatorSpeaking || classInference.speaking;

          if (isCurrentlySpeaking) {
            if (previousLogicalState !== 'speaking') {
              (window as any).logBot?.(`🎤 [Google] SPEAKER_START: ${participantName} (ID: ${participantId})`);
              sendSpeakerEventToHost('SPEAKER_START', participantElement);
            }
            speakingStates.set(participantId, 'speaking');
          } else {
            if (previousLogicalState === 'speaking') {
              (window as any).logBot?.(`🔇 [Google] SPEAKER_END: ${participantName} (ID: ${participantId})`);
              sendSpeakerEventToHost('SPEAKER_END', participantElement);
            }
            speakingStates.set(participantId, 'silent');
          }
        };

        const observeGoogleParticipant = (participantElement: HTMLElement) => {
          const participantId = getGoogleParticipantId(participantElement);
          speakingStates.set(participantId, 'silent');
          logGoogleSpeakerEvent(participantElement);

          const callback = (mutationsList: MutationRecord[]) => {
            for (const mutation of mutationsList) {
              if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const targetElement = mutation.target as HTMLElement;
                if (participantElement.contains(targetElement) || participantElement === targetElement) {
                  logGoogleSpeakerEvent(participantElement, targetElement.classList);
                }
              }
            }
          };

          const observer = new MutationObserver(callback);
          observer.observe(participantElement, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
          });

          if (!(participantElement as any).dataset.vexaObserverAttached) {
            (participantElement as any).dataset.vexaObserverAttached = 'true';
          }
        };

        const scanForAllGoogleParticipants = () => {
          const participantSelectors: string[] = selectorsTyped.participantSelectors || [];
          for (const sel of participantSelectors) {
            document.querySelectorAll(sel).forEach((el) => {
              const elh = el as HTMLElement;
              if (!(elh as any).dataset.vexaObserverAttached) {
                observeGoogleParticipant(elh);
              }
            });
          }
        };

        const setupGoogleMutationObserver = () => {
          const containerSelectors: string[] = selectorsTyped.containerSelectors || [];
          for (const sel of containerSelectors) {
            const container = document.querySelector(sel);
            if (container) {
              const containerObserver = new MutationObserver(() => {
                scanForAllGoogleParticipants();
              });
              containerObserver.observe(container, {
                childList: true,
                subtree: true
              });
            }
          }
        };

        scanForAllGoogleParticipants();
        setupGoogleMutationObserver();

        const peopleButtonSelectors: string[] = selectorsTyped.peopleButtonSelectors || [];
        for (const buttonSelector of peopleButtonSelectors) {
          const button = document.querySelector(buttonSelector) as HTMLElement | null;
          if (button) {
            button.addEventListener('click', () => {
              setTimeout(() => {
                scanForAllGoogleParticipants();
              }, 1500);
            });
          }
        }

        if (typeof signalSessionControl === 'function') {
          signalSessionControl({ event: 'RECORDING_STARTED' }).catch(() => {});
        }
      },
      {
        botConfigData: botConfig,
        selectors: {
          participantSelectors: googleParticipantSelectors,
          speakingClasses: googleSpeakingClassNames,
          silenceClasses: googleSilenceClassNames,
          containerSelectors: googleParticipantContainerSelectors,
          nameSelectors: googleNameSelectors,
          speakingIndicators: googleSpeakingIndicators,
          peopleButtonSelectors: googlePeopleButtonSelectors
        }
      }
    );

    log('[Google Recording] Browser instrumentation complete; waiting for meeting to conclude.');
    await new Promise<void>(() => {});
  } catch (error: any) {
    log(`[Google Recording] Failed to initialize Google Meet recording: ${error?.message || error}`);
    throw error;
  } finally {
    try {
      await speechService.shutdown('google_meet_recording_stopped');
    } catch (error: any) {
      log(`[Google Recording] Error during transcription shutdown: ${error?.message || error}`);
    }
    if (serviceRegistered) {
      setTranscriptionService(null);
    }
  }
}
