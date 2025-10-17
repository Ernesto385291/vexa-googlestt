import { TranscriptionService } from "./types";

let currentService: TranscriptionService | null = null;

export function setTranscriptionService(service: TranscriptionService | null): void {
  currentService = service;
}

export function getTranscriptionService(): TranscriptionService | null {
  return currentService;
}
