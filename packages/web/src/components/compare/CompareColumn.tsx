import React from 'react';
import Avatar from '../ui/Avatar';

export interface CompareColumnProps {
  id: string;
  name: string | undefined;
  isMe: boolean;
}

export default function CompareColumn({ name, isMe }: CompareColumnProps) {
  return (
    <th className="py-2 px-2 text-center min-w-[72px]">
      <div className="flex flex-col items-center gap-1">
        <Avatar name={name || 'User'} size="sm" />
        <span className="text-[11px] normal-case font-medium text-text-secondary truncate max-w-[72px]">
          {isMe ? 'You' : (name || 'Member')}
        </span>
      </div>
    </th>
  );
}
