import React from 'react';

interface InputProps extends React.ComponentPropsWithoutRef<'input'> {
  label?: string;
  error?: string;
  helperText?: string;
  /** Shown to the right of the input (e.g. dictation control). */
  suffix?: React.ReactNode;
}

export function Input({ 
  label, 
  error, 
  helperText, 
  className = '', 
  id,
  suffix,
  ...props 
}: InputProps) {
  const inputClassName = `
          block ${suffix ? 'min-w-0 flex-1' : 'w-full'} px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm 
          placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 
          focus:border-blue-500 transition-all disabled:opacity-50 disabled:pointer-events-none
          ${error ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' : ''}
          ${className}
        `;
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
          {label}
        </label>
      )}
      {suffix ? (
        <div className="flex gap-2 items-stretch">
          <input id={id} className={inputClassName} {...props} />
          {suffix}
        </div>
      ) : (
        <input id={id} className={inputClassName} {...props} />
      )}
      {error && (
        <p className="text-xs font-medium text-red-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="text-xs text-slate-500">{helperText}</p>
      )}
    </div>
  );
}
