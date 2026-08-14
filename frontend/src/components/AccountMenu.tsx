import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type AccountMenuProps = {
  compact?: boolean;
};

export function AccountMenu({ compact = false }: AccountMenuProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const initials = user.full_name?.charAt(0).toUpperCase() || "U";
  const avatarSrc = user.avatar_url?.startsWith("http")
    ? user.avatar_url
    : user.avatar_url || undefined;

  const triggerClass = compact
    ? "flex size-9 items-center justify-center overflow-hidden rounded-full bg-[#6366f1] text-sm font-bold text-white transition hover:bg-[#4f46e5]"
    : "flex size-9 items-center justify-center overflow-hidden rounded-full bg-[#6366f1] text-sm font-bold text-white transition hover:bg-[#4f46e5]";

  return (
    <button
      type="button"
      aria-label="My profile"
      title="My profile"
      className={triggerClass}
      onClick={() => navigate("/profile")}
    >
      {avatarSrc ? (
        <img src={avatarSrc} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        initials
      )}
    </button>
  );
}
