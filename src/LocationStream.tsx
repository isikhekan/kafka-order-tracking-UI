// LocationStream.tsx
/// <reference types="vite/client" />
import { useEffect, useRef } from "react";

type Props = {
  clientId: string
  onConnect?: () => void
  onLocation?: (data: any) => void
  onMessage?: (data: any) => void // fallback for default 'message' events
  urlOverride?: string // optionally pass full SSE url
  eventNames?: string[] // custom SSE event names, e.g. ['orders.location']
}

export default function LocationStream({ clientId, onConnect, onLocation, onMessage, urlOverride, eventNames }: Props) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = urlOverride || `${import.meta.env.VITE_API_BASE}/stream/location/${clientId}`
    const es = new EventSource(url);
    esRef.current = es;

    const handlePing = () => {
      onConnect?.()
      // console.log("SSE connected")
    }
    const handleLocation = (e: MessageEvent) => {
      try { onLocation?.(JSON.parse(e.data)) } catch { /* ignore */ }
    }
    const handleMessage = (e: MessageEvent) => {
      try { onMessage?.(JSON.parse(e.data)) } catch { /* ignore */ }
    }

    es.addEventListener("ping", handlePing)
    // default known event
    es.addEventListener("location", handleLocation)
    // custom kafka-forwarded events
    if (eventNames && eventNames.length > 0) {
      for (const ev of eventNames) {
        es.addEventListener(ev, handleLocation)
      }
    }
    es.onmessage = handleMessage

    es.onerror = () => {
      // EventSource otomatik retry yapar
      // console.warn("SSE error; browser will retry")
    };

    return () => {
      es.removeEventListener("ping", handlePing)
      es.removeEventListener("location", handleLocation)
      if (eventNames && eventNames.length > 0) {
        for (const ev of eventNames) {
          es.removeEventListener(ev, handleLocation)
        }
      }
      es.close();
    }
  }, [clientId, onConnect, onLocation, onMessage, urlOverride, JSON.stringify(eventNames)]);

  return null;
}
