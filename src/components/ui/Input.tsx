import React from 'react';

interface InputProps extends React.ComponentPropsWithoutRef<'input'> {
  label?: string;
  error?: string;
  helperText?: string;
}

export function Input({ 
  label, 
  error, 
  helperText, 
  className = '', 
  id,
  ...props 
}: InputProps) {
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`
          block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm 
          placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 
          focus:border-blue-500 transition-all disabled:opacity-50 disabled:pointer-events-none
          ${error ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' : ''}
          ${className}
        `}
        {...props}
      />
      {error && (
        <p className="text-xs font-medium text-red-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="text-xs text-slate-500">{helperText}</p>
      )}
    </div>
  );
}
