// Centralized Google Meet selectors and indicators
// Keep this file free of runtime logic; export constants only.

export const googleInitialAdmissionIndicators: string[] = [
  // Most reliable indicators: UI controls that appear when in meeting
  'button[aria-label*="People"]',
  'button[aria-label*="people"]',
  'button[aria-label*="Chat"]',
  'button[aria-label*="chat"]',
  'button[aria-label*="Leave call"]',
  'button[aria-label*="Leave meeting"]',
  '[role="toolbar"]',
  '[data-participant-id]',
  'button[aria-label*="Turn off microphone"]',
  'button[aria-label*="Turn on microphone"]'
];

export const googleWaitingRoomIndicators: string[] = [
  // Modern waiting room text patterns (2024 Google Meet UI)
  'text="Asking to be let in..."',
  'text*="Asking to be let in"',
  'text="You\'ll join the call when someone lets you in"',
  'text*="You\'ll join the call when someone lets you"',
  'text="Please wait until a meeting host brings you into the call"',
  'text="Waiting for the host to let you in"',
  'text="You\'re in the waiting room"',
  'text="Asking to be let in"',
  
  // Aria labels and waiting room indicators
  '[aria-label*="waiting room"]',
  '[aria-label*="Asking to be let in"]',
  '[aria-label*="waiting for admission"]',
  
  // Progress/loading indicators in waiting room
  '[role="progressbar"]',
  '[aria-label*="loading"]',
  '.loading-spinner',
  
  // Legacy patterns (keep for compatibility)
  'text="Ask to join"',
  'text="Join now"',
  'text="Can\'t join the meeting"',
  'text="Meeting not found"'
];

export const googleRejectionIndicators: string[] = [
  // Meeting not found or access denied patterns
  'text="Meeting not found"',
  'text="Can\'t join the meeting"',
  'text="Unable to join"',
  'text="Access denied"',
  'text="Meeting has ended"',
  'text="This meeting has ended"',
  'text="Invalid meeting"',
  'text="Meeting link expired"',
  
  // Error dialog indicators
  '[role="dialog"]:has-text("not found")',
  '[role="alertdialog"]:has-text("not found")',
  '[role="dialog"]:has-text("ended")',
  '[role="alertdialog"]:has-text("ended")',
  
  // Retry/error buttons
  'button:has-text("Try again")',
  'button:has-text("Retry")',
  'button:has-text("Go back")',
  'button[aria-label*="retry"]',
  'button[aria-label*="try again"]'
];

export const googleAdmissionIndicators: string[] = [
  // Meeting toolbar and controls (most reliable admission indicators)
  'button[aria-label*="Chat"]',
  'button[aria-label*="chat"]',
  'button[aria-label*="People"]',
  'button[aria-label*="people"]',
  'button[aria-label*="Participants"]',
  'button[aria-label*="Leave call"]',
  'button[aria-label*="Leave meeting"]',
  
  // Audio/video controls that appear when in meeting
  'button[aria-label*="Turn off microphone"]',
  'button[aria-label*="Turn on microphone"]',
  'button[aria-label*="Turn off camera"]',
  'button[aria-label*="Turn on camera"]',
  
  // Share and present buttons
  'button[aria-label*="Share screen"]',
  'button[aria-label*="Present now"]',
  
  // Meeting toolbar and controls
  '[role="toolbar"]',
  '[data-participant-id]',
  '[data-self-name]',
  
  // Audio level indicators
  '[data-audio-level]',
  '[aria-label*="microphone"]',
  '[aria-label*="camera"]',
  
  // Meeting controls toolbar
  '[data-tooltip*="microphone"]',
  '[data-tooltip*="camera"]',
  
  // Video tiles and meeting UI
  '[aria-label*="meeting"]',
  'div[data-meeting-id]'
];

// Participant-related selectors for speaker detection
export const googleParticipantSelectors: string[] = [
  'div[data-participant-id]', // Primary Google Meet participant selector
  '[data-participant-id]',
  '[aria-label*="participant"]',
  '[data-self-name]',
  '.participant-tile',
  '.video-tile'
];

export const googleSpeakingClassNames: string[] = [
  'Oaajhc', // Google Meet speaking animation class
  'HX2H7',  // Alternative speaking class
  'wEsLMd', // Another speaking indicator
  'OgVli',  // Additional speaking class
  'speaking', 
  'active-speaker', 
  'speaker-active', 
  'speaking-indicator',
  'audio-active', 
  'mic-active', 
  'microphone-active', 
  'voice-active',
  'speaking-border', 
  'speaking-glow', 
  'speaking-highlight'
];

export const googleSilenceClassNames: string[] = [
  'gjg47c', // Google Meet silence class
  'silent', 
  'muted', 
  'mic-off', 
  'microphone-off', 
  'audio-inactive',
  'participant-silent', 
  'user-silent', 
  'no-audio'
];

export const googleParticipantContainerSelectors: string[] = [
  '[data-participant-id]',
  '[data-self-name]',
  '.participant-tile',
  '.video-tile',
  '[jsname="BOHaEe"]' // Google Meet meeting container
];

// Leave button selectors (used in browser context via page.evaluate)
export const googlePrimaryLeaveButtonSelectors: string[] = [
  // Primary Google Meet leave button
  'button[aria-label="Leave call"]',
  
  // Alternative leave button patterns
  'button[aria-label*="Leave"]',
  'button[aria-label*="leave"]',
  'button[aria-label*="End meeting"]',
  'button[aria-label*="end meeting"]',
  'button[aria-label*="Hang up"]',
  'button[aria-label*="hang up"]',
  
  // Toolbar-based selectors
  '[role="toolbar"] button[aria-label*="Leave"]'
];

export const googleSecondaryLeaveButtonSelectors: string[] = [
  // Confirmation dialog leave buttons
  'button:has-text("Leave meeting")',
  'button:has-text("Just leave the meeting")',
  'button:has-text("Leave")',
  'button:has-text("End meeting")',
  'button:has-text("Hang up")',
  'button:has-text("End call")',
  'button:has-text("Leave call")',
  
  // Dialog-specific selectors
  '[role="dialog"] button:has-text("Leave")',
  '[role="dialog"] button:has-text("End meeting")',
  '[role="alertdialog"] button:has-text("Leave")',
  
  // Generic confirmation patterns
  'button[aria-label*="confirm"]:has-text("Leave")',
  'button[aria-label*="confirm"]:has-text("End")'
];

// Google Meet name selectors for participant identification
export const googleNameSelectors: string[] = [
  // Google Meet specific name selectors
  'span.notranslate', // Primary name element in Google Meet
  '[data-self-name]',
  '.zWGUib',
  '.cS7aqe.N2K3jd',
  '.XWGOtd',
  '[data-tooltip*="name"]',
  '[aria-label*="name"]',
  '.participant-name',
  '.display-name',
  '.user-name'
];

// Google Meet speaking indicators (primary speaker detection)
export const googleSpeakingIndicators: string[] = [
  // Google Meet uses class-based detection primarily
  '.Oaajhc', // Speaking animation class
  '.HX2H7',  // Alternative speaking class
  '.wEsLMd', // Another speaking indicator
  '.OgVli'   // Additional speaking class
];

// Google Meet removal/error state indicators
export const googleRemovalIndicators: string[] = [
  // Meeting ended messages
  'text="Meeting ended"',
  'text*="Meeting ended"',
  'text="Call ended"',
  'text*="Call ended"',
  'text="You left the meeting"',
  'text*="You left the meeting"',
  
  // Connection issues
  'text="Connection lost"',
  'text*="Connection lost"',
  'text="Unable to connect"',
  'text*="Unable to connect"',
  'text="Reconnecting"',
  'text*="Reconnecting"',
  
  // Generic error patterns
  '[role="alert"]',
  '[role="alertdialog"]',
  '.error-message',
  '.connection-error',
  '.meeting-error'
];

// Google Meet UI interaction selectors
export const googleJoinButtonSelectors: string[] = [
  '//button[.//span[text()="Ask to join"]]',
  'button:has-text("Ask to join")',
  'button:has-text("Join now")',
  'button:has-text("Join")'
];

export const googleCameraButtonSelectors: string[] = [
  '[aria-label*="Turn off camera"]',
  'button[aria-label*="Turn off camera"]',
  'button[aria-label*="Turn on camera"]'
];

export const googleMicrophoneButtonSelectors: string[] = [
  '[aria-label*="Turn off microphone"]',
  'button[aria-label*="Turn off microphone"]',
  'button[aria-label*="Turn on microphone"]'
];

export const googleNameInputSelectors: string[] = [
  'input[type="text"][aria-label="Your name"]',
  'input[placeholder*="name"]',
  'input[placeholder*="Name"]'
];

// Google Meet meeting container selectors
export const googleMeetingContainerSelectors: string[] = [
  '[jsname="BOHaEe"]', // Primary Google Meet container
  '[role="main"]',
  'body'
];

// Google Meet participant ID selectors
export const googleParticipantIdSelectors: string[] = [
  '[data-participant-id]',
  '[data-self-name]',
  '[jsinstance]'
];

// Google Meet comprehensive leave selectors (stateless - covers all scenarios)
export const googleLeaveSelectors: string[] = [
  // Primary Google Meet leave button
  'button[aria-label="Leave call"]',

  // Alternative leave patterns (native CSS only)
  'button[aria-label*="Leave"]',
  'button[aria-label*="leave"]',
  '[role="toolbar"] button[aria-label*="Leave"]',

  // End meeting alternatives
  'button[aria-label*="End meeting"]',
  'button[aria-label*="end meeting"]',
  'button[aria-label*="Hang up"]',
  'button[aria-label*="hang up"]',

  // Dialog-specific patterns using aria-labels (text-only matches are not valid CSS)
  '[role="dialog"] button[aria-label*="Leave"]',
  '[role="dialog"] button[aria-label*="End"]',
  '[role="alertdialog"] button[aria-label*="Leave"]',

  // Generic close/cancel patterns
  'button[aria-label="Close"]',
  'button[aria-label*="Close"]',
  'button[aria-label="Cancel"]',
  'button[aria-label*="Cancel"]',

  // Fallback patterns
  'input[type="button"][value="Leave"]',
  'input[type="submit"][value="Leave"]'
];

// Google Meet people/participant panel selectors
// IMPORTANT: These selectors must be valid native CSS selectors because they are used inside
// document.querySelector within page.evaluate. Do not use Playwright-only selectors like
// :has-text() or non-standard pseudo-classes like :contains().
export const googlePeopleButtonSelectors: string[] = [
  'button[aria-label^="People"]',
  'button[aria-label*="people"]',
  'button[aria-label*="Participants"]',
  'button[aria-label*="participants"]',
  'button[aria-label*="Show people"]',
  'button[aria-label*="show people"]',
  'button[aria-label*="View people"]',
  'button[aria-label*="view people"]',
  'button[aria-label*="Meeting participants"]',
  'button[aria-label*="meeting participants"]',
  // The following rely on accessible tooltips/labels which are stable across Meet UIs
  '[data-tooltip*="people"]',
  '[data-tooltip*="People"]',
  '[data-tooltip*="participants"]',
  '[data-tooltip*="Participants"]'
];


