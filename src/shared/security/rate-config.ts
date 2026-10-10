export const authRateRules = {
  "/sign-up/email": { window: 60, max: 5 },
  "/sign-in/email": { window: 60, max: 5 },
  "/request-password-reset": { window: 60, max: 3 },
  "/send-verification-email": { window: 60, max: 3 },
} as const;
export const rateRules = {
  messageUser: { window: 60, max: 60 },
  messageConversation: { window: 60, max: 30 },
  reportUser: { window: 3600, max: 10 },
  jobDraftUser: { window: 3600, max: 60 },
} as const;
