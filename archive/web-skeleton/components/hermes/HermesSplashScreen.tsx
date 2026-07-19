"use client";

interface HermesSplashScreenProps {
  leaving?: boolean;
}

export function HermesSplashScreen({ leaving = false }: HermesSplashScreenProps) {
  return (
    <div
      className={`hermes-splash${leaving ? " hermes-splash--leaving" : ""}`}
      aria-hidden={leaving}
    >
      <div className="hermes-splash__inner">
        <div className="hermes-splash__mark" aria-hidden="true">
          LQ
        </div>
        <h1 className="hermes-splash__title">LifeQuest</h1>
        <p className="hermes-splash__version">v0.1.0</p>
      </div>
    </div>
  );
}
