"use client";

import { useSyncExternalStore } from "react";

const consentKey = "blueprint-analytics-consent";

export function PrivacyControls() {
  const visible = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("blueprint-consent-change", onStoreChange);
      return () => window.removeEventListener("blueprint-consent-change", onStoreChange);
    },
    () => window.localStorage.getItem(consentKey) === null,
    () => false,
  );
  if (!visible) return null;
  const decide = (value: "granted" | "denied") => {
    window.localStorage.setItem(consentKey, value);
    window.dispatchEvent(new Event("blueprint-consent-change"));
  };
  return <aside className="consent-banner" aria-label="Cookie preferences"><div><strong>Privacy choices</strong><p>Blueprint uses essential storage for your draft and optional anonymous product analytics. You can reject analytics without affecting interviews.</p></div><div className="consent-actions"><button className="tool-button" onClick={() => decide("denied")}>Reject analytics</button><button className="primary-button" onClick={() => decide("granted")}>Accept analytics</button></div></aside>;
}
