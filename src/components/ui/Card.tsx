import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'flat' | 'outline';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export function Card({ 
  children, 
  className = '', 
  variant = 'default', 
  padding = 'md',
  onClick
}: CardProps) {
  const variants = {
    default: 'bg-white shadow-sm border border-slate-100',
    flat: 'bg-slate-50 border border-slate-100',
    outline: 'bg-transparent border border-slate-200',
  };

  const paddings = {
    none: 'p-0',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };

  const interactiveClasses = onClick ? 'cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]' : '';

  return (
    <div 
      className={`rounded-3xl overflow-hidden ${variants[variant]} ${paddings[padding]} ${interactiveClasses} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
