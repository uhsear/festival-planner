import { useAuthStore } from '../stores/authStore';
import {
  LoginRequest,
  RegisterRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  AvatarResponse,
} from '../types';

export interface UseAuthReturn {
  login: (request: LoginRequest) => Promise<void>;
  register: (request: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (request: ForgotPasswordRequest) => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<void>;
  uploadAvatar: (file: File | Blob) => Promise<AvatarResponse>;
  removeAvatar: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useAuth(): UseAuthReturn {
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const logout = useAuthStore((state) => state.logout);
  const forgotPassword = useAuthStore((state) => state.forgotPassword);
  const changePassword = useAuthStore((state) => state.changePassword);
  const uploadAvatar = useAuthStore((state) => state.uploadAvatar);
  const removeAvatar = useAuthStore((state) => state.removeAvatar);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);

  return {
    login,
    register,
    logout,
    forgotPassword,
    changePassword,
    uploadAvatar,
    removeAvatar,
    isLoading,
    error,
  };
}
