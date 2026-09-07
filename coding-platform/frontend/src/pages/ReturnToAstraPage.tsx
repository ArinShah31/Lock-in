import { MagicCard } from "../components/ui/magic-card";

const ASTRA_URL = import.meta.env.VITE_ASTRA_URL ?? "http://localhost:5173";

/** Shown when this app is opened directly instead of via ASTRA's SSO handoff. */
export function ReturnToAstraPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3f5d9b]">Astra Coding</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#031635]">Open this from ASTRA</h1>
      <MagicCard className="mt-6 w-full p-6 shadow-sm">
        <p className="text-sm text-[#44474e]">
          The coding platform is opened from inside ASTRA — there is no separate sign-in here. Go to
          ASTRA and open the <strong>Coding</strong> section for your classroom.
        </p>
        <a
          href={ASTRA_URL}
          className="mt-5 inline-block w-full rounded-md bg-[#031635] py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a2b4b]"
        >
          Go to ASTRA
        </a>
      </MagicCard>
    </div>
  );
}
