import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { EditProfileModal } from "../components/EditProfileModal";
import {
  ErrorText,
  Field,
  GhostButton,
  inputClass,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../components/ui";

export function AccountSettingsPage() {
  const { user, logout, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!user) return null;

  async function saveName() {
    setSavingName(true);
    setError(null);
    setMessage(null);
    try {
      await authApi.updateMe({ full_name: fullName.trim() });
      await refreshMe();
      setMessage("Name updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update name");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword() {
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setSavingPassword(true);
    setError(null);
    setMessage(null);
    try {
      await authApi.changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Account Settings" subtitle="Manage your personal information and security." />

      <Panel className="space-y-4">
        <h2 className="font-display text-lg font-bold text-[#031635]">Personal Information</h2>
        <Field label="Name">
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={inputClass} value={user.email} disabled />
        </Field>
        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={() => void saveName()} disabled={savingName}>
            {savingName ? "Saving..." : "Save name"}
          </PrimaryButton>
          <GhostButton onClick={() => setEditOpen(true)}>Edit profile photo</GhostButton>
        </div>
      </Panel>

      <Panel className="space-y-4">
        <h2 className="font-display text-lg font-bold text-[#031635]">Security</h2>
        {user.role && (
          <p className="text-sm text-[#44474e]">
            Role: <span className="font-semibold text-[#031635]">{user.role.replaceAll("_", " ")}</span> (managed by your institution)
          </p>
        )}
        <Field label="Current password">
          <input
            type="password"
            className={inputClass}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            className={inputClass}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            className={inputClass}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <PrimaryButton onClick={() => void savePassword()} disabled={savingPassword || !currentPassword || !newPassword}>
          {savingPassword ? "Updating..." : "Change password"}
        </PrimaryButton>
      </Panel>

      <Panel className="space-y-3 border-[#ffdad6]">
        <h2 className="font-display text-lg font-bold text-[#ba1a1a]">Danger Zone</h2>
        <p className="text-sm text-[#44474e]">Sign out of ASTRA on this device.</p>
        <GhostButton
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          Sign out
        </GhostButton>
      </Panel>

      {error ? <ErrorText message={error} /> : null}
      {message ? <p className="text-sm font-semibold text-[#031635]">{message}</p> : null}

      <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} initialName={user.full_name} />
    </div>
  );
}
