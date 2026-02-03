import { useRef, useCallback } from 'react';

export function useWakeLock() {
  const wakeLock = useRef<any>(null);

  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        // @ts-ignore
        wakeLock.current = await navigator.wakeLock.request('screen');
        console.log('Wake Lock active');
      } catch (err) {
        console.warn('Wake Lock failed:', err);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLock.current) {
      try {
        await wakeLock.current.release();
        wakeLock.current = null;
        console.log('Wake Lock released');
      } catch (err) {
        console.warn('Release Wake Lock failed:', err);
      }
    }
  }, []);

  return { requestWakeLock, releaseWakeLock };
}
