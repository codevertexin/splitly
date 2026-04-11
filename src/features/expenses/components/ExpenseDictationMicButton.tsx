import React from 'react';
import { Mic } from 'lucide-react';

type ExpenseDictationMicButtonProps = {
  isListening: boolean;
  onClick: () => void;
  disabled?: boolean;
  labels: {
    start: string;
    stop: string;
  };
};

export function ExpenseDictationMicButton({
  isListening,
  onClick,
  disabled,
  labels,
}: ExpenseDictationMicButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isListening}
      aria-label={isListening ? labels.stop : labels.start}
      className={`
        inline-flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border text-slate-600
        transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-1
        disabled:pointer-events-none disabled:opacity-40
        ${
          isListening
            ? 'border-red-300 bg-red-50 text-red-600 shadow-sm'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
        }
      `}
    >
      <Mic className={`h-4 w-4 ${isListening ? 'animate-pulse' : ''}`} aria-hidden />
    </button>
  );
}
