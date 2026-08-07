const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

type GoogleCredentialResponse = {
  credential?: string;
};

type GooglePromptNotification = {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  isDismissedMoment: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
};

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  prompt: (momentListener?: (notification: GooglePromptNotification) => void) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: string;
      theme?: string;
      size?: string;
      text?: string;
      shape?: string;
      width?: number;
    },
  ) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleAccountsId;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load Google Sign-In"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Opens Google Identity Services account chooser and returns an ID token (JWT).
 */
export async function requestGoogleIdToken(): Promise<string> {
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  if (!clientId) {
    throw new Error("Google Sign-In is not configured. Set VITE_GOOGLE_CLIENT_ID.");
  }

  await loadGisScript();
  if (!window.google?.accounts?.id) {
    throw new Error("Google Sign-In failed to initialize");
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    window.google!.accounts.id.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        if (response.credential) {
          finish(() => resolve(response.credential!));
        } else {
          finish(() => reject(new Error("Google Sign-In returned no credential")));
        }
      },
    });

    window.google!.accounts.id.prompt((notification) => {
      if (notification.isDismissedMoment()) {
        finish(() => reject(new Error("Google Sign-In was cancelled")));
        return;
      }
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // Fallback: show official Google button in a small dialog the user can click once.
        showGoogleButtonFallback(clientId, resolve, reject, () => settled, (v) => {
          settled = v;
        });
      }
    });
  });
}

function showGoogleButtonFallback(
  clientId: string,
  resolve: (token: string) => void,
  reject: (err: Error) => void,
  isSettled: () => boolean,
  setSettled: (v: boolean) => void,
) {
  if (isSettled()) return;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);";

  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fff;border-radius:16px;padding:24px;min-width:280px;display:flex;flex-direction:column;align-items:center;gap:16px;box-shadow:0 20px 50px rgba(0,0,0,0.2);";

  const title = document.createElement("p");
  title.textContent = "Continue with Google";
  title.style.cssText = "margin:0;font-weight:700;color:#0f172a;font-size:16px;";

  const buttonHost = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.style.cssText =
    "border:none;background:transparent;color:#64748b;font-weight:600;cursor:pointer;padding:8px;";

  const cleanup = () => {
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
  };

  cancel.onclick = () => {
    cleanup();
    if (!isSettled()) {
      setSettled(true);
      reject(new Error("Google Sign-In was cancelled"));
    }
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) cancel.onclick?.(e as unknown as MouseEvent);
  };

  panel.appendChild(title);
  panel.appendChild(buttonHost);
  panel.appendChild(cancel);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  window.google!.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      cleanup();
      if (response.credential) {
        if (!isSettled()) {
          setSettled(true);
          resolve(response.credential);
        }
      } else if (!isSettled()) {
        setSettled(true);
        reject(new Error("Google Sign-In returned no credential"));
      }
    },
  });

  window.google!.accounts.id.renderButton(buttonHost, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "pill",
    width: 280,
  });
}
