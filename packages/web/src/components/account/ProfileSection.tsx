import React, { useRef, useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Avatar from '../ui/Avatar';
import { AtSign, Camera, Trash2, User } from 'lucide-react';

interface ProfileSectionProps {
  user: {
    name?: string;
    username?: string;
    avatar?: string;
  };
}

export default function ProfileSection({ user }: ProfileSectionProps) {
  const { toast } = useToast();
  const storeUser = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const uploadAvatar = useAuthStore((s) => s.uploadAvatar);
  const removeAvatar = useAuthStore((s) => s.removeAvatar);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user.name || '');
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    try {
      await uploadAvatar(file);
      toast('Avatar updated', 'success');
    } catch {
      toast("Couldn't upload avatar. Try again.", 'error');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAvatarRemove = async () => {
    setRemovingAvatar(true);
    try {
      await removeAvatar();
      toast('Avatar removed', 'success');
    } catch {
      toast("Couldn't remove avatar. Try again.", 'error');
    } finally {
      setRemovingAvatar(false);
    }
  };

  const handleDisplayNameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = displayName.trim();
    if (!next) return;

    setSavingDisplayName(true);
    try {
      const res = await api.put<{ user: { name?: string } }>('/account/display-name', {
        displayName: next,
      });
      if (storeUser) setUser({ ...storeUser, name: res.user?.name ?? next });
      toast('Display name updated', 'success');
    } catch {
      toast("Couldn't change display name. Try again.", 'error');
    } finally {
      setSavingDisplayName(false);
    }
  };

  return (
    <>
      {/* Avatar section */}
      <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
          <Camera className="w-4 h-4" aria-hidden="true" />
          Avatar
        </h3>

        <div className="flex items-center gap-4">
          <Avatar name={user.name || user.username || 'User'} image={user.avatar} size="lg" />

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              isLoading={uploadingAvatar}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] min-w-[44px]"
            >
              Upload
            </Button>

            {user.avatar && (
              <Button
                variant="ghost"
                size="sm"
                isLoading={removingAvatar}
                onClick={handleAvatarRemove}
                className="min-h-[44px] min-w-[44px]"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          aria-label="Upload new avatar"
          onChange={handleAvatarUpload}
        />
      </section>

      {/* Display name section */}
      <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
          <User className="w-4 h-4" aria-hidden="true" />
          Display name
        </h3>

        <form onSubmit={handleDisplayNameChange} className="flex gap-2">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How your name appears to your crew"
            className="flex-1"
            autoComplete="name"
            maxLength={50}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={savingDisplayName}
            disabled={!displayName.trim() || displayName.trim() === (user.name ?? '')}
            className="min-h-[44px] min-w-[44px]"
          >
            Save
          </Button>
        </form>

        {/* Username is the permanent @handle — shown read-only. */}
        {user.username ? (
          <div className="flex items-center gap-2 pt-1 text-sm text-text-secondary">
            <AtSign className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              <span className="text-text-primary font-medium">@{user.username}</span>
              <span className="text-text-muted"> · username can’t be changed</span>
            </span>
          </div>
        ) : null}
      </section>
    </>
  );
}
