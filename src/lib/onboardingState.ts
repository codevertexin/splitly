export type OnboardingState = {
  hasCreatedGroup: boolean;
  hasCreatedExpense: boolean;
  hasSeenSettlementHint: boolean;
};

const ONBOARDING_STATE_KEY = 'splitly_onboarding_state_v1';

const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  hasCreatedGroup: false,
  hasCreatedExpense: false,
  hasSeenSettlementHint: false,
};

export function getOnboardingState(): OnboardingState {
  if (typeof window === 'undefined') return { ...DEFAULT_ONBOARDING_STATE };
  try {
    const raw = localStorage.getItem(ONBOARDING_STATE_KEY);
    if (!raw) return { ...DEFAULT_ONBOARDING_STATE };
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      hasCreatedGroup: Boolean(parsed.hasCreatedGroup),
      hasCreatedExpense: Boolean(parsed.hasCreatedExpense),
      hasSeenSettlementHint: Boolean(parsed.hasSeenSettlementHint),
    };
  } catch {
    return { ...DEFAULT_ONBOARDING_STATE };
  }
}

export function updateOnboardingState(partial: Partial<OnboardingState>): OnboardingState {
  const next = { ...getOnboardingState(), ...partial };
  if (typeof window !== 'undefined') {
    localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(next));
  }
  return next;
}

