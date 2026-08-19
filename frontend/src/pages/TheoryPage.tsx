import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { theoryPlatformApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, PageHeader, Panel } from "../components/ui";

export function TheoryPage() {
  const { user } = useAuth();
  const isTeacher = user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER";
  const isStudent = user?.role === "STUDENT";

  const access = useQuery({
    queryKey: ["theory-access"],
    queryFn: theoryPlatformApi.access,
  });

  const [ssoError, setSsoError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!access.data?.enabled || (!isTeacher && !isStudent)) return;
    let cancelled = false;
    setRedirecting(true);
    void (async () => {
      try {
        const { token, frontend_url } = await theoryPlatformApi.ssoToken();
        if (cancelled) return;
        window.location.assign(`${frontend_url}/sso?token=${encodeURIComponent(token)}`);
      } catch (e) {
        if (!cancelled) {
          setSsoError(e instanceof Error ? e.message : "Could not open theory platform");
          setRedirecting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access.data?.enabled, isStudent, isTeacher]);

  if (access.isLoading) {
    return (
      <div>
        <PageHeader title="Theory" subtitle="Loading access…" />
      </div>
    );
  }

  if (!isTeacher && !isStudent) {
    return (
      <div>
        <PageHeader title="Theory" />
        <Panel>
          <EmptyState title="Not available" body="Theory platform is for teachers and students." />
        </Panel>
      </div>
    );
  }

  if (!access.data?.enabled) {
    return (
      <div>
        <PageHeader title="Theory" subtitle="Written-answer assessments with Bloom rubrics." />
        <Panel>
          <EmptyState
            title="Theory platform is disabled"
            body={access.data?.reason || "Ask your HOD to enable the theory platform."}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Theory" subtitle="Opening your theory workspace…" />
      <Panel>
        <ErrorText message={ssoError} />
        <p className="text-sm text-[#44474e]">
          {redirecting ? "Redirecting to the theory platform…" : "Waiting…"}
        </p>
      </Panel>
    </div>
  );
}
