// Type definitions for Cloudflare Turnstile
declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, params: any) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export { };

