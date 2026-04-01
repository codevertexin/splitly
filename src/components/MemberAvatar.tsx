import React, { useState } from 'react';

export type MemberAvatarSize = 'sm' | 'md' | 'lg';

export type MemberAvatarProps = {
  userId: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  size?: MemberAvatarSize;
  className?: string;
};

function initialsFromNameOrId(name?: string | null, userId?: string) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
  }
  if (userId) {
    const compact = userId.replace(/-/g, '');
    return compact.slice(0, 2).toUpperCase() || '?';
  }
  return '?';
}

const SIZE_CLASSES: Record<MemberAvatarSize, string> = {
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-12 h-12 text-sm',
};

export function MemberAvatar({
  userId,
  fullName,
  avatarUrl,
  size = 'md',
  className = '',
}: MemberAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const sc = SIZE_CLASSES[size];
  const label = initialsFromNameOrId(fullName, userId);
  const showImg = Boolean(avatarUrl) && !imgFailed;

  const ring = 'rounded-full shrink-0 border border-slate-200/90 bg-slate-50';

  if (showImg) {
    return (
      <img
        src={avatarUrl!}
        alt=""
        className={`${sc} ${ring} object-cover ${className}`}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sc} ${ring} bg-blue-100 text-blue-700 flex items-center justify-center font-bold ${className}`}
      aria-hidden
    >
      {label}
    </div>
  );
}
