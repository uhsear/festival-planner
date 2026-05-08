import React, { useRef, useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Avatar from '../ui/Avatar';
import { Camera, Trash2, User } from 'lucide-react';

interface ProfileSectionProps {
  user: {
    name?: string;
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

  const [username, setUsername] = useState(user.name || '');
  const [savingUsername, setSavingUsername] = useState(false);
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

  const handleUsernameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setSavingUsername(true);
    try {
      const updated = await api.put<{ name: string }>('/account/username', {
        username: username.trim(),
      });
      if (storeUser) setUser({ ...storeUser, name: updated.name ?? username.trim() });
      toast('Username updated', 'success');
    } catch {
      toast("Couldn't change username. Try again.", 'error');
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <>
      {/* Avatar section */}
      <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
        <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
          <Camera className="w-4 h-4" aria-hidden="true" />
          Avatar
        </h2>

        <div className="flex items-center gap-4">
          <Avatar name={user.name || 'User'} image={user.avatar} size="lg" />

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

      {/* Username section */}
      <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
        <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
          <User className="w-4 h-4" aria-hidden="true" />
          Username
        </h2>

        <form onSubmit={handleUsernameChange} className="flex gap-2">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Display name"
            className="flex-1"
            autoComplete="username"
            maxLength={40}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={savingUsername}
            disabled={!username.trim() || username === user.name}
            className="min-h-[44px] min-w-[44px]"
          >
            Save
          </Button>
        </form>
      </section>
    </>
  );
}
