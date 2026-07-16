import { Redirect } from 'expo-router';

// Deep-link shim: a shared web /cards link should resolve on mobile instead of
// 404ing. Mobile has no standalone /cards route — Cards is a Schedule view mode,
// so carry that explicit request to the tab instead of letting its festival
// default overwrite the shared link. PUBLIC: not in AuthGate's guestBlocked.
export default function CardsDeepLink() {
  return <Redirect href={{ pathname: '/(tabs)', params: { scheduleView: 'cards' } }} />;
}
