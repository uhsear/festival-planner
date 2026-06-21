import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useUI } from '../contexts/UIContext';

// Deep-link shim: a shared web /cards link should resolve on mobile instead of
// 404ing. Mobile has no standalone /cards route — Cards is a Schedule view mode
// (see UIContext) — so set the view mode and bounce to the tabs. Mirrors web's
// own /me -> /account redirect pattern. PUBLIC: not in AuthGate's guestBlocked.
export default function CardsDeepLink() {
  const { setViewMode } = useUI();
  useEffect(() => {
    setViewMode('cards');
  }, [setViewMode]);
  return <Redirect href="/(tabs)" />;
}
