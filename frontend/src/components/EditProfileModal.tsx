import { useEffect, useState, type RefObject } from "react";
import { authApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, Field, GhostButton, inputClass, PrimaryButton } from "./ui";

type EditProfileModalProps = {
  open: boolean;
  onClose: () => void;
  initialName: string;
  onSaved?: () => void;
  anchorRef: RefObject<HTMLElement | null>;
};

export function EditProfileModal({ open, onClose, initialName, onSaved, anchorRef }: EditProfileModalProps) {
  const { refreshMe } = useAuth();
  const [fullName, setFullName] = useState(initialName);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName(initialName);
    setAvatarFile(null);
    setPreviewUrl(null);
    setError(null);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = 384;
      const panelHeight = 360;
      const margin = 12;
      const left = Math.min(
        Math.max(margin, rect.right - panelWidth),
        window.innerWidth - panelWidth - margin,
      );
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const top =
        spaceBelow >= panelHeight
          ? rect.bottom + 8
          : Math.max(margin, rect.top - panelHeight - 8);
      setPosition({ top, left });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !position) return null;

  async function handleSave() {
    setLoading(true);
    setError(null);
    try {
      if (fullName.trim() !== initialName.trim()) {
        await authApi.updateMe({ full_name: fullName.trim() });
      }
      if (avatarFile) {
        await authApi.uploadAvatar(avatarFile);
      }
      await refreshMe();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close edit profile"
        className="fixed inset-0 z-40 bg-[#031635]/20"
        onClick={onClose}
      />
      <div
        className="fixed z-50 w-full max-w-sm rounded-xl border border-[#e1e3e4] bg-white p-5 shadow-xl"
        style={{ top: position.top, left: position.left }}
        role="dialog"
        aria-labelledby="edit-profile-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="edit-profile-title" className="font-display text-lg font-bold text-[#031635]">
              Edit Profile
            </h2>
            <p className="mt-1 text-sm text-[#44474e]">Update your display name or profile photo.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#75777f] hover:text-[#031635]" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <Field label="Display name">
            <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Profile photo">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={inputClass}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setAvatarFile(file);
                setPreviewUrl(file ? URL.createObjectURL(file) : null);
              }}
            />
            {previewUrl ? (
              <img src={previewUrl} alt="Avatar preview" className="mt-2 size-16 rounded-full object-cover" />
            ) : null}
          </Field>
          {error ? <ErrorText message={error} /> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => void handleSave()} disabled={loading || fullName.trim().length < 2}>
            {loading ? "Saving..." : "Save changes"}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
}
