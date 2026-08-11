import { FormEvent, useState } from "react";
import { Navigate, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classroomsApi } from "../api";
import type { Classroom } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  Field,
  inputClass,
  PrimaryButton,
} from "../components/ui";

type OutletCtx = { classroom: Classroom };

export function ClassroomAnnouncementsTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });

  const isStudent = user?.role === "STUDENT";
  const isOwner =
    !!user &&
    (user.role === "CLASS_TEACHER" || user.role === "SUBJECT_TEACHER") &&
    user.id === classroom.class_teacher_id;

  const announcements = useQuery({
    queryKey: ["classroom-announcements", id],
    queryFn: () => classroomsApi.listAnnouncements(id),
    enabled: !isStudent && !Number.isNaN(id),
  });

  const createAnnouncement = useMutation({
    mutationFn: (body: { title: string; body: string }) =>
      classroomsApi.createAnnouncement(id, body),
    onSuccess: async () => {
      setAnnouncement({ title: "", body: "" });
      setError(null);
      await qc.invalidateQueries({ queryKey: ["classroom-announcements", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isStudent) {
    return <Navigate to={`/classrooms/${id}/dashboard`} replace />;
  }

  function onPostAnnouncement(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createAnnouncement.mutate(announcement);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-extrabold text-[#031635]">Announcements</h2>
        <p className="mt-1 text-sm text-[#75777f]">
          Post updates for this classroom. Students see them in their notification bell.
        </p>
      </div>

      <ErrorText message={error} />

      {isOwner ? (
        <form className="grid gap-3 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4" onSubmit={onPostAnnouncement}>
          <Field label="Announcement title">
            <input
              className={inputClass}
              value={announcement.title}
              onChange={(e) => setAnnouncement((a) => ({ ...a, title: e.target.value }))}
              required
            />
          </Field>
          <Field label="Body">
            <textarea
              className={inputClass}
              rows={4}
              value={announcement.body}
              onChange={(e) => setAnnouncement((a) => ({ ...a, body: e.target.value }))}
              required
            />
          </Field>
          <div>
            <PrimaryButton type="submit" disabled={createAnnouncement.isPending}>
              {createAnnouncement.isPending ? "Posting…" : "Post announcement"}
            </PrimaryButton>
          </div>
        </form>
      ) : (
        <p className="text-sm text-[#75777f]">Only the class teacher can post announcements.</p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-[#75777f]">
          Posted announcements
        </h3>
        {announcements.isLoading ? (
          <p className="text-sm text-[#75777f]">Loading announcements…</p>
        ) : !announcements.data?.length ? (
          <EmptyState
            title="No announcements yet"
            body="Post an announcement above to notify students via their bell."
          />
        ) : (
          <ul className="space-y-2">
            {announcements.data.map((a) => (
              <li key={a.id} className="rounded-xl border border-[#e1e3e4] bg-white px-3.5 py-3">
                <p className="font-semibold text-[#031635]">{a.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#44474e]">{a.body}</p>
                {a.created_at ? (
                  <p className="mt-2 text-[11px] text-[#75777f]">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
