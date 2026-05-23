import { Stack } from 'expo-router';
import { colors } from '@festie/shared/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.primary },
      }}
    />
  );
}
