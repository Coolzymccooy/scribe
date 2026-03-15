import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Monitors browser connectivity and fires a callback on reconnect.
 */
export const useConnectivityMonitor = (onReconnect?: () => void) => {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const wasOfflineRef = useRef(!navigator.onLine);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      onReconnectRef.current?.();
    }
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    wasOfflineRef.current = true;
  }, []);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return isOnline;
};
