import { Page } from "playwright";
import { log } from "../../utils";
import { BotConfig } from "../../types";
import { GoogleSpeechService } from "../../services/googleSpeech";
import { setTranscriptionService } from "../../services/transcription/registry";
import {
  teamsParticipantSelectors,
  teamsSpeakingClassNames,
  teamsSilenceClassNames,
  teamsParticipantContainerSelectors,
  teamsNameSelectors,
  teamsSpeakingIndicators,
  teamsVoiceLevelSelectors,
  teamsOcclusionSelectors,
  teamsStreamTypeSelectors,
  teamsAudioActivitySelectors,
  teamsParticipantIdSelectors,
  teamsMeetingContainerSelectors
} from "./selectors";

const BROWSER_UTILS_PATH = require('path').join(__dirname, '../../browser-utils.global.js');

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
        const policy = (window as any).trustedTypes?.createPolicy('vexaPolicyTeams', {
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
        const policy = (window as any).trustedTypes?.createPolicy('vexaPolicyTeamsUrl', {
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
      console.log('VexaBrowserUtils loaded keys for Teams:', Object.keys(utils));
    } catch (error) {
      console.error('Error injecting browser utils script (Teams):', (error as any)?.message || error);
      throw error;
    }
  }, scriptContent);
}

export async function startTeamsRecording(page: Page, botConfig: BotConfig): Promise<void> {
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
          voiceLevelSelectors: string[];
          occlusionSelectors: string[];
          streamTypeSelectors: string[];
          audioActivitySelectors: string[];
          participantIdSelectors: string[];
          meetingContainerSelectors: string[];
        };
      }) => {
        const { botConfigData, selectors } = pageArgs;
        const browserUtils = (window as any).VexaBrowserUtils;
        if (!browserUtils) {
          throw new Error('Browser utilities not available in Teams page context');
        }

        const sendAudioChunk = (window as any).vexaSendAudioChunk;
        const sendSpeakerEvent = (window as any).vexaSendSpeakerEvent;
        const updateTranscriptionConfig = (window as any).vexaUpdateTranscriptionConfig;
        const signalSessionControl = (window as any).vexaSignalSessionControl;

        (window as any).__vexaBotConfig = { ...botConfigData };
        (window as any).__vexaPendingReconfigure = null;

        const transcriptionBridge = {
          botConfigData: { ...botConfigData },
          isServerReady: true,
          isReady(): boolean {
            return true;
          },
          setServerReady(): void {},
          sendAudioChunkMetadata(): boolean {
            return true;
          },
          sendAudioData(audioData: Float32Array): boolean {
            if (typeof sendAudioChunk !== 'function') {
              (window as any).logBot?.('[Teams][Audio] Bridge unavailable; dropping chunk.');
              return false;
            }
            const payload: AudioChunkPayload = {
              samples: Array.from(audioData),
              sampleRate: 16000,
              sessionStartTime: audioService.getSessionAudioStartTime()
            };
            Promise.resolve(sendAudioChunk(payload)).catch((error: any) => {
              (window as any).logBot?.(`[Teams][Audio] Failed to send chunk: ${error?.message || error}`);
            });
            return true;
          },
          sendSpeakerEvent(eventType: string, participantName: string, participantId: string, relativeTimestampMs: number): boolean {
            if (typeof sendSpeakerEvent !== 'function') {
              return false;
            }
            const payload: SpeakerBridgePayload = {
              eventType,
              participantName,
              participantId,
              relativeTimestampMs
            };
            Promise.resolve(sendSpeakerEvent(payload)).catch((error: any) => {
              (window as any).logBot?.(`[Teams][Speaker] Failed to send ${eventType}: ${error?.message || error}`);
            });
            return true;
          },
          sendSessionControl(event: string): boolean {
            if (typeof signalSessionControl === 'function') {
              Promise.resolve(signalSessionControl({ event })).catch(() => {});
            }
            return true;
          },
          close(): void {},
          updateBridgeConfig(botCfg: any) {
            this.botConfigData = botCfg;
            (window as any).__vexaBotConfig = { ...botCfg };
          }
        };

        const audioService = new browserUtils.BrowserAudioService({
          targetSampleRate: 16000,
          bufferSize: 4096,
          inputChannels: 1,
          outputChannels: 1
        });

        (window as any).__vexaTranscriptionService = transcriptionBridge;
        (window as any).triggerWebSocketReconfigure = async (lang: string | null, task: string | null) => {
          try {
            const cfg = (window as any).__vexaBotConfig || {};
            cfg.language = lang;
            cfg.task = task || 'transcribe';
            transcriptionBridge.updateBridgeConfig(cfg);
            if (typeof updateTranscriptionConfig === 'function') {
              await updateTranscriptionConfig({ language: cfg.language, task: cfg.task });
              (window as any).logBot?.(`[Reconfigure] Applied: language=${cfg.language}, task=${cfg.task}`);
            }
          } catch (error: any) {
            (window as any).logBot?.(`[Reconfigure] Error applying new config: ${error?.message || error}`);
          }
        };

        document.addEventListener('vexa:reconfigure', (ev: Event) => {
          try {
            const detail = (ev as CustomEvent).detail || {};
            const fn = (window as any).triggerWebSocketReconfigure;
            if (typeof fn === 'function') fn(detail.lang, detail.task);
          } catch {}
        });

        (window as any).logBot?.('Starting Microsoft Teams recording with Google STT bridge.');

        const mediaElements = await audioService.findMediaElements();
        if (mediaElements.length === 0) {
          throw new Error('[Teams BOT Error] No active media elements found after multiple retries. Ensure the Teams meeting media is playing.');
        }

        const combinedStream = await audioService.createCombinedAudioStream(mediaElements);
        await audioService.initializeAudioProcessor(combinedStream);

        audioService.setupAudioDataProcessor((audioData: Float32Array, sessionStartTime: number | null) => {
          transcriptionBridge.sendAudioData(audioData);
        });

        const selectorsTyped = selectors as any;
        const speakingStates = new Map<string, string>();

        const getTeamsParticipantId = (element: HTMLElement) => {
          let id = element.getAttribute('data-tid') ||
            element.getAttribute('data-participant-id') ||
            element.getAttribute('data-user-id') ||
            element.getAttribute('data-object-id') ||
            element.getAttribute('id');

          if (!id) {
            const stableChild = selectorsTyped.participantIdSelectors && selectorsTyped.participantIdSelectors.length > 0
              ? element.querySelector(selectorsTyped.participantIdSelectors.join(', ')) as HTMLElement | null
              : null;
            if (stableChild) {
              id = stableChild.getAttribute('data-tid') ||
                stableChild.getAttribute('data-participant-id') ||
                stableChild.getAttribute('data-user-id');
            }
          }

          if (!id) {
            if (!(element as any).dataset.vexaGeneratedId) {
              (element as any).dataset.vexaGeneratedId = 'teams-id-' + Math.random().toString(36).substr(2, 9);
            }
            id = (element as any).dataset.vexaGeneratedId;
          }

          return id as string;
        };

        const getTeamsParticipantName = (participantElement: HTMLElement) => {
          const nameSelectors: string[] = selectorsTyped.nameSelectors || [];
          for (const selector of nameSelectors) {
            const nameElement = participantElement.querySelector(selector) as HTMLElement;
            if (nameElement) {
              let nameText = nameElement.textContent || nameElement.innerText || nameElement.getAttribute('title') || nameElement.getAttribute('aria-label') || '';
              if (nameText) {
                nameText = nameText.trim();
                const forbiddenSubstrings = [
                  "more_vert", "mic_off", "mic", "videocam", "videocam_off",
                  "present_to_all", "devices", "speaker", "speakers", "microphone",
                  "camera", "camera_off", "share", "chat", "participant", "user"
                ];
                if (!forbiddenSubstrings.some(sub => nameText.toLowerCase().includes(sub.toLowerCase())) && nameText.length > 1 && nameText.length < 50) {
                  return nameText;
                }
              }
            }
          }

          const ariaLabel = participantElement.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.includes('name')) {
            const nameMatch = ariaLabel.match(/name[:\s]+([^,]+)/i);
            if (nameMatch && nameMatch[1]) {
              const nameText = nameMatch[1].trim();
              if (nameText.length > 1 && nameText.length < 50) {
                return nameText;
              }
            }
          }

          return `Teams Participant (${getTeamsParticipantId(participantElement)})`;
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

        const hasVoiceLevelElement = (participantElement: HTMLElement): boolean => {
          const selectors: string[] = selectorsTyped.voiceLevelSelectors || [];
          for (const selector of selectors) {
            const voiceElement = participantElement.querySelector(selector) as HTMLElement | null;
            if (voiceElement && isVisible(voiceElement)) {
              return true;
            }
          }
          return false;
        };

        const inferSpeakingFromClasses = (participantElement: HTMLElement, mutatedClassList?: DOMTokenList) => {
          const speakingClasses: string[] = selectorsTyped.speakingClasses || [];
          const silenceClasses: string[] = selectorsTyped.silenceClasses || [];

          const classList = mutatedClassList || participantElement.classList;
          const isSpeakingByClass = speakingClasses.some((cls: string) => classList.contains(cls));
          const isSilentByClass = silenceClasses.some((cls: string) => classList.contains(cls));

          if (isSpeakingByClass) {
            return { speaking: true };
          }
          if (isSilentByClass) {
            return { speaking: false };
          }
          return { speaking: false };
        };

        const sendTeamsSpeakerEvent = (eventType: string, participantElement: HTMLElement) => {
          const sessionStartTime = audioService.getSessionAudioStartTime();
          if (sessionStartTime === null) {
            return;
          }
          const relativeTimestampMs = Date.now() - sessionStartTime;
          const participantId = getTeamsParticipantId(participantElement);
          const participantName = getTeamsParticipantName(participantElement);
          transcriptionBridge.sendSpeakerEvent(eventType, participantName, participantId, relativeTimestampMs);
        };

        const logTeamsSpeakerEvent = (participantElement: HTMLElement, mutatedClassList?: DOMTokenList) => {
          const participantId = getTeamsParticipantId(participantElement);
          const participantName = getTeamsParticipantName(participantElement);
          const previousLogicalState = speakingStates.get(participantId) || "silent";

          const indicatorSpeaking = hasVoiceLevelElement(participantElement);
          const classInference = inferSpeakingFromClasses(participantElement, mutatedClassList);
          const isCurrentlySpeaking = indicatorSpeaking || classInference.speaking;

          if (isCurrentlySpeaking) {
            if (previousLogicalState !== "speaking") {
              (window as any).logBot?.(`🎤 [Teams] SPEAKER_START: ${participantName} (ID: ${participantId})`);
              sendTeamsSpeakerEvent("SPEAKER_START", participantElement);
            }
            speakingStates.set(participantId, "speaking");
          } else {
            if (previousLogicalState === "speaking") {
              (window as any).logBot?.(`🔇 [Teams] SPEAKER_END: ${participantName} (ID: ${participantId})`);
              sendTeamsSpeakerEvent("SPEAKER_END", participantElement);
            }
            speakingStates.set(participantId, "silent");
          }
        };

        const observeTeamsParticipant = (participantElement: HTMLElement) => {
          const participantId = getTeamsParticipantId(participantElement);
          speakingStates.set(participantId, "silent");
          logTeamsSpeakerEvent(participantElement);

          const callback = (mutationsList: MutationRecord[]) => {
            for (const mutation of mutationsList) {
              if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const targetElement = mutation.target as HTMLElement;
                if (participantElement.contains(targetElement) || participantElement === targetElement) {
                  logTeamsSpeakerEvent(participantElement, targetElement.classList);
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

        const scanForAllTeamsParticipants = () => {
          const participantSelectors: string[] = selectorsTyped.participantSelectors || [];
          for (const selector of participantSelectors) {
            document.querySelectorAll(selector).forEach((participant) => {
              const participantElement = participant as HTMLElement;
              if (!(participantElement as any).dataset.vexaObserverAttached) {
                observeTeamsParticipant(participantElement);
              }
            });
          }
        };

        const setupTeamsMutationObservers = () => {
          const containerSelectors: string[] = selectorsTyped.containerSelectors || [];
          for (const selector of containerSelectors) {
            const container = document.querySelector(selector);
            if (container) {
              const observer = new MutationObserver(() => {
                scanForAllTeamsParticipants();
              });
              observer.observe(container, {
                childList: true,
                subtree: true
              });
            }
          }

          const meetingContainerSelectors: string[] = selectorsTyped.meetingContainerSelectors || [];
          for (const selector of meetingContainerSelectors) {
            (document.querySelectorAll(selector) as NodeListOf<HTMLElement>).forEach((meetingContainer) => {
              const observer = new MutationObserver(() => {
                scanForAllTeamsParticipants();
              });
              observer.observe(meetingContainer, {
                childList: true,
                subtree: true
              });
            });
          }
        };

        scanForAllTeamsParticipants();
        setupTeamsMutationObservers();

        if (typeof signalSessionControl === 'function') {
          signalSessionControl({ event: 'RECORDING_STARTED' }).catch(() => {});
        }
      },
      {
        botConfigData: botConfig,
        selectors: {
          participantSelectors: teamsParticipantSelectors,
          speakingClasses: teamsSpeakingClassNames,
          silenceClasses: teamsSilenceClassNames,
          containerSelectors: teamsParticipantContainerSelectors,
          nameSelectors: teamsNameSelectors,
          speakingIndicators: teamsSpeakingIndicators,
          voiceLevelSelectors: teamsVoiceLevelSelectors,
          occlusionSelectors: teamsOcclusionSelectors,
          streamTypeSelectors: teamsStreamTypeSelectors,
          audioActivitySelectors: teamsAudioActivitySelectors,
          participantIdSelectors: teamsParticipantIdSelectors,
          meetingContainerSelectors: teamsMeetingContainerSelectors
        }
      }
    );

    log('[Teams Recording] Browser instrumentation complete; waiting for meeting to conclude.');
    await new Promise<void>(() => {});
  } catch (error: any) {
    log(`[Teams Recording] Failed to initialize Teams recording: ${error?.message || error}`);
    throw error;
  } finally {
    try {
      await speechService.shutdown('teams_recording_stopped');
    } catch (error: any) {
      log(`[Teams Recording] Error during transcription shutdown: ${error?.message || error}`);
    }
    if (serviceRegistered) {
      setTranscriptionService(null);
    }
  }
}
