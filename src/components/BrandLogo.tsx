import React from 'react';
import { useTranslation } from 'react-i18next';

const LOGO_SRC = '/logo-splitly.png';

export type BrandLogoProps = {
  /** horizontal = ícone + wordmark; mark = recorte para espaços estreitos (ex.: rail tablet) */
  variant?: 'horizontal' | 'mark';
  className?: string;
  alt?: string;
};

export function BrandLogo({
  variant = 'horizontal',
  className = '',
  alt,
}: BrandLogoProps) {
  const { t } = useTranslation();
  const resolvedAlt = alt ?? t('brand.name');

  if (variant === 'mark') {
    return (
      <span
        className={`inline-flex shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-100/80 ${className}`}
        title={resolvedAlt}
      >
        <img
          src={LOGO_SRC}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 object-cover object-left sm:h-[3.25rem] sm:w-[3.25rem]"
          style={{ objectPosition: '15% center' }}
        />
      </span>
    );
  }

  return (
    <img
      src={LOGO_SRC}
      alt={resolvedAlt}
      width={220}
      height={48}
      className={`h-10 w-auto max-w-full object-contain object-left sm:h-12 ${className}`}
    />
  );
}
