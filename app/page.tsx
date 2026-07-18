import { Suspense } from "react";
import { HermesSplashScreen } from "@/components/hermes/HermesSplashScreen";
import { HermesStartupScreen } from "@/components/hermes/HermesStartupScreen";

/** App entry — connect to local Hermes Agent, then sign-in (if needed), then shell. */
export default function WelcomePage() {
  return (
    <Suspense fallback={<HermesSplashScreen />}>
      <HermesStartupScreen />
    </Suspense>
  );
}
