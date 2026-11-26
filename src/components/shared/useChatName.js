import { useApp } from '../../state/appStore';

// The signed-in user's first name, for labelling their own chat messages.
export default function useChatName() {
  const { state } = useApp();
  const raw = (state.settings?.surveyor_name || state.settings?.name || '').trim()
    || (state.currentUser?.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  const first = raw.split(/\s+/)[0] || 'You';
  return first.charAt(0).toUpperCase() + first.slice(1);
}
