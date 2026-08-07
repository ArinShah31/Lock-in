import { useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classroomAnalyticsApi } from "../api";
import type { AnalyticsGrant, Classroom, SourceAnalyticsSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, Field, GhostButton, inputClass, PrimaryButton } from "../components/ui";

type OutletCtx = { classroom: Classroom };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function SourceSummaryView({ viewerId, sourceId }: { viewerId: number; sourceId: number }) {
  const summary = useQuery({
    queryKey: ["analytics-source-summary", viewerId, sourceId],
    queryFn: () => classroomAnalyticsApi.sourceSummary(viewerId, sourceId),
  });

  if (summary.isLoading) return <p className="text-sm text-mist">Loading analytics…</p>;
  if (summary.isError) {
    return (
      <ErrorText
        message={summary.error instanceof Error ? summary.error.message : "Could not load analytics"}
      />
    );
  }

  const data = summary.data as SourceAnalyticsSummary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="font-semibold text-paper">
            {data.source_classroom_name} · {data.source_classroom_code}
          </h4>
          {data.source_teacher_name ? (
            <p className="text-xs text-mist">Taught by {data.source_teacher_name} · view only</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-xs text-mist">Students</p>
          <p className="text-lg font-semibold text-paper">{data.student_count}</p>
        </div>
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-xs text-mist">Assignments</p>
          <p className="text-lg font-semibold text-paper">{data.assignment_count}</p>
        </div>
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-xs text-mist">Avg completion</p>
          <p className="text-lg font-semibold text-paper">
            {data.average_completion_pct != null ? `${data.average_completion_pct}%` : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-xs text-mist">Course</p>
          <p className="text-lg font-semibold text-paper">
            {data.course_published ? "Published" : "Not published"}
          </p>
        </div>
      </div>

      {!data.students.length ? (
        <EmptyState title="No students yet" body="This classroom has no approved students." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.1em] text-mist">
                <th className="py-2 pr-3 font-semibold">Student</th>
                <th className="py-2 pr-3 font-semibold">Submitted</th>
                <th className="py-2 pr-3 font-semibold">Avg score</th>
                <th className="py-2 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.student_id} className="border-b border-line/60">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-paper">{s.full_name}</p>
                    <p className="text-xs text-mist">{s.email}</p>
                  </td>
                  <td className="py-2 pr-3 text-mist">
                    {s.assignments_submitted}/{s.assignments_total}
                  </td>
                  <td className="py-2 pr-3 text-mist">
                    {s.average_score_pct != null ? `${s.average_score_pct}%` : "—"}
                  </td>
                  <td className="py-2 text-mist">{formatDate(s.last_submission_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ClassroomAnalyticsTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const qc = useQueryClient();
  const isOwner = !!user && user.id === classroom.class_teacher_id;

  const [error, setError] = useState<string | null>(null);
  const [viewerCodeInput, setViewerCodeInput] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const shareCode = useQuery({
    queryKey: ["analytics-share-code", id],
    queryFn: () => classroomAnalyticsApi.getShareCode(id),
    enabled: isOwner && !Number.isNaN(id),
  });

  const inbound = useQuery({
    queryKey: ["analytics-grants-inbound", id],
    queryFn: () => classroomAnalyticsApi.listInbound(id),
    enabled: isOwner && !Number.isNaN(id),
  });

  const outbound = useQuery({
    queryKey: ["analytics-grants-outbound", id],
    queryFn: () => classroomAnalyticsApi.listOutbound(id),
    enabled: isOwner && !Number.isNaN(id),
  });

  const rotate = useMutation({
    mutationFn: () => classroomAnalyticsApi.rotateShareCode(id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["analytics-share-code", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const grant = useMutation({
    mutationFn: () => classroomAnalyticsApi.grantAccess(id, viewerCodeInput.trim()),
    onSuccess: () => {
      setError(null);
      setViewerCodeInput("");
      void qc.invalidateQueries({ queryKey: ["analytics-grants-outbound", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const revoke = useMutation({
    mutationFn: (grantId: number) => classroomAnalyticsApi.revoke(id, grantId),
    onSuccess: (removed: AnalyticsGrant) => {
      setError(null);
      if (removed.source_classroom_id === selectedSourceId) setSelectedSourceId(null);
      void qc.invalidateQueries({ queryKey: ["analytics-grants-inbound", id] });
      void qc.invalidateQueries({ queryKey: ["analytics-grants-outbound", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!isOwner) {
    return (
      <EmptyState
        title="Analytics unavailable"
        body="Only the classroom owner can view shared analytics."
      />
    );
  }

  const inboundGrants = inbound.data ?? [];
  const outboundGrants = outbound.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-xl text-paper">Analytics</h2>
        <p className="text-sm text-mist">
          Link classrooms to see how your students perform in other teachers’ classes. Sharing is
          view-only — it never grants access to teaching tools.
        </p>
      </div>

      <ErrorText message={error} />

      <section className="space-y-3 rounded-2xl border border-line p-4">
        <h3 className="font-semibold text-paper">Your analytics code</h3>
        <p className="text-sm text-mist">
          Give this code to another teacher. When they add it in their classroom, that classroom’s
          analytics appear here.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-line bg-panel-low px-4 py-2 font-mono text-lg tracking-[0.2em] text-paper">
            {shareCode.data?.analytics_share_code ?? "········"}
          </span>
          <GhostButton
            onClick={() => {
              const code = shareCode.data?.analytics_share_code;
              if (!code) return;
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </GhostButton>
          <GhostButton disabled={rotate.isPending} onClick={() => rotate.mutate()}>
            Rotate code
          </GhostButton>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-line p-4">
        <h3 className="font-semibold text-paper">Share this classroom’s analytics</h3>
        <p className="text-sm text-mist">
          Paste another classroom’s analytics code to let its teacher see this classroom’s analytics
          (view only).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Field label="Their analytics code">
              <input
                className={inputClass}
                placeholder="e.g. 7KQ2MB9X"
                value={viewerCodeInput}
                onChange={(e) => setViewerCodeInput(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <PrimaryButton
            disabled={grant.isPending || viewerCodeInput.trim().length < 6}
            onClick={() => grant.mutate()}
          >
            Share analytics
          </PrimaryButton>
        </div>
        {outboundGrants.length ? (
          <ul className="space-y-2">
            {outboundGrants.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm"
              >
                <span className="text-mist">
                  Shared with{" "}
                  <span className="font-medium text-paper">
                    {g.viewer_classroom_name ?? `Classroom ${g.viewer_classroom_id}`}
                  </span>
                  {g.viewer_classroom_code ? ` · ${g.viewer_classroom_code}` : ""}
                </span>
                <GhostButton disabled={revoke.isPending} onClick={() => revoke.mutate(g.id)}>
                  Revoke
                </GhostButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-mist">Not shared with any classroom yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-paper">Linked classroom analytics</h3>
        {!inboundGrants.length ? (
          <EmptyState
            title="No linked classrooms yet"
            body="When another teacher adds your analytics code in their classroom, it will appear here."
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {inboundGrants.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    selectedSourceId === g.source_classroom_id
                      ? "border-accent/50 bg-accent/10 text-paper"
                      : "border-line text-mist hover:text-paper"
                  }`}
                  onClick={() => setSelectedSourceId(g.source_classroom_id)}
                >
                  <span className="font-medium">
                    {g.source_classroom_name ?? `Classroom ${g.source_classroom_id}`}
                  </span>
                  {g.source_teacher_name ? (
                    <span className="block text-xs text-mist">{g.source_teacher_name}</span>
                  ) : null}
                </button>
              ))}
            </div>
            {selectedSourceId != null ? (
              <div className="rounded-2xl border border-line p-4">
                <SourceSummaryView viewerId={id} sourceId={selectedSourceId} />
                <div className="mt-4 border-t border-line pt-3">
                  <GhostButton
                    disabled={revoke.isPending}
                    onClick={() => {
                      const g = inboundGrants.find((x) => x.source_classroom_id === selectedSourceId);
                      if (g) revoke.mutate(g.id);
                    }}
                  >
                    Remove this link
                  </GhostButton>
                </div>
              </div>
            ) : (
              <p className="text-sm text-mist">Select a linked classroom to view its analytics.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
