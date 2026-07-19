/// <reference types="vite/client" />

interface LifequestBridge {
  ping: () => string;
}

interface Window {
  lifequest?: LifequestBridge;
}
