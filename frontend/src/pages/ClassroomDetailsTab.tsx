import { FormEvent, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classroomsApi } from "../api";
import type { Classroom } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import {
  ErrorText,
  GhostButton,
  PrimaryButton,
} from "../components/ui";

type OutletCtx = { classroom: Classroom };
type LocationState = { success?: string };

export function ClassroomDetailsTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const location = useLocation();
  const id = Number(classroomId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const navState = (location.state as LocationState | null) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [success] = useState<string | null>(navState?.success ?? null);
  const isStudent = user?.role === "STUDENT";
  const isOwner =
    (user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER") &&
    user.id === classroom.class_teacher_id;

  const students = useQuery({
    queryKey: ["classroom-students", id],
    queryFn: () => classroomsApi.listStudents(id),
    enabled: !isStudent && !Number.isNaN(id),
  });
  const joinRequests = useQuery({
    queryKey: ["classroom-join-requests", id],
    queryFn: () => classroomsApi.listJoinRequests(id),
    enabled: isOwner && !Number.isNaN(id),
  });

  const approveJoin = useMutation({
    mutationFn: (studentId: number) => classroomsApi.approveJoin(id, studentId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["classroom-join-requests", id] }),
        qc.invalidateQueries({ queryKey: ["classroom-students", id] }),
      ]);
    },
    onError: (err: Error) => setError(err.message),
  });

  const rejectJoin = useMutation({
    mutationFn: (studentId: number) => classroomsApi.rejectJoin(id, studentId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["classroom-join-requests", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeStudent = useMutation({
    mutationFn: (studentId: number) => classroomsApi.removeStudent(id, studentId),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["classroom-students", id] }),
    onError: (err: Error) => setError(err.message),
  });

  const deactivate = useMutation({
    mutationFn: () => classroomsApi.deactivate(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["classrooms"] });
      navigate("/classrooms", { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-6">
      <ErrorText message={error} />
      {success ? (
        <p className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">{success}</p>
      ) : null}

      <div>
        <p className="text-paper">{classroom.description || "No description"}</p>
        <p className="mt-1 text-xs text-mist">Year: {classroom.academic_year || "—"}</p>
        {isOwner ? (
          <p className="mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
            Share join code:{" "}
            <span className="font-display text-lg tracking-[0.25em] text-accent">{classroom.join_code}</span>
          </p>
        ) : null}
      </div>

      {isOwner ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Pending join requests</h3>
          {!joinRequests.data?.length ? (
            <p className="text-sm text-mist">No pending requests.</p>
          ) : (
            <ul className="space-y-2">
              {joinRequests.data.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm"
                >
                  <span>
                    <span className="text-paper">{r.student_full_name ?? `Student ${r.student_id}`}</span>
                    <span className="text-mist"> · {r.student_email}</span>
                  </span>
                  <div className="flex gap-2">
                    <PrimaryButton onClick={() => approveJoin.mutate(r.student_id)}>Approve</PrimaryButton>
                    <GhostButton onClick={() => rejectJoin.mutate(r.student_id)}>Reject</GhostButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {!isStudent ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Students</h3>
          {!students.data?.length ? (
            <p className="text-sm text-mist">No approved students yet.</p>
          ) : (
            <ul className="space-y-2">
              {students.data.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm"
                >
                  <span>
                    {s.student_full_name ?? `Student ${s.student_id}`}
                    <span className="text-mist">{s.student_email ? ` · ${s.student_email}` : ""}</span>
                  </span>
                  {isOwner ? (
                    <GhostButton onClick={() => removeStudent.mutate(s.student_id)}>Remove</GhostButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {isOwner && classroom.is_active ? (
        <div className="border-t border-line pt-4">
          <GhostButton onClick={() => deactivate.mutate()}>Deactivate classroom</GhostButton>
        </div>
      ) : null}
    </div>
  );
}
