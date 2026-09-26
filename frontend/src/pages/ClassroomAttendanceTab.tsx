import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attendanceApi } from "../api";
import type { AttendanceSession, MyAttendance } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  Field,
  inputClass,
  Panel,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function pctTone(value: number | null | undefined) {
  if (value == null) return "text-[#75777f]";
  if (value >= 75) return "text-[#2f6b4f]";
  if (value >= 60) return "text-[#9a6b2f]";
  return "text-[#ba1a1a]";
}

export function ClassroomAttendanceTab() {
  const { user } = useAuth();
  if (user?.role === "STUDENT") return <StudentAttendance />;
  return <TeacherAttendance />;
}

/* ------------------------------------------------------------------ student */

function StudentAttendance() {
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const mine = useQuery({
    queryKey: ["attendance-mine", id],
    queryFn: () => attendanceApi.mine(id),
    enabled: !Number.isNaN(id),
  });

  if (mine.isLoading) return <p className="text-sm text-[#44474e]">Loading attendance…</p>;
  if (mine.isError) return <ErrorText message={(mine.error as Error).message} />;
  const data: MyAttendance | undefined = mine.data;
  if (!data || data.subjects.length === 0) {
    return (
      <EmptyState
        title="No attendance yet"
        body="Your teachers haven't added any subjects or marked attendance."
        icon="fact_check"
      />
    );
  }

  return (
    <div className="space-y-6">
      <Panel>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#75777f]">
          Overall attendance
        </p>
        <p className={`mt-1 font-display text-4xl font-bold ${pctTone(data.final_percent)}`}>
          {pct(data.final_percent)}
        </p>
        <p className="mt-1 text-xs text-[#75777f]">Average across all subjects with lectures held.</p>
      </Panel>

      {data.subjects.map((s) => (
        <Panel key={s.subject_id}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-bold text-[#031635]">
              {s.subject_name} <span className="text-sm font-medium text-[#75777f]">({s.subject_code})</span>
            </h3>
            <p className="text-sm text-[#44474e]">
              {s.attended}/{s.held} lectures ·{" "}
              <span className={`font-bold ${pctTone(s.percent)}`}>{pct(s.percent)}</span>
            </p>
          </div>
          {s.lectures.length === 0 ? (
            <p className="text-sm text-[#75777f]">No lectures marked yet.</p>
          ) : (
            <ul className="divide-y divide-[#e1e3e4]">
              {s.lectures.map((l) => (
                <li key={l.session_id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-[#191c1d]">
                    {l.held_on}
                    {l.title ? <span className="text-[#75777f]"> · {l.title}</span> : null}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-bold ${
                      l.present ? "bg-[#e7f3ec] text-[#2f6b4f]" : "bg-[#ffdad6] text-[#ba1a1a]"
                    }`}
                  >
                    {l.present ? "Present" : "Absent"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ teacher */

function TeacherAttendance() {
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const qc = useQueryClient();
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const summary = useQuery({
    queryKey: ["attendance-summary", id],
    queryFn: () => attendanceApi.summary(id),
    enabled: !Number.isNaN(id),
  });

  useEffect(() => {
    if (subjectId == null && summary.data?.subjects.length) {
      setSubjectId(summary.data.subjects[0].id);
    }
  }, [summary.data, subjectId]);

  const subject = useQuery({
    queryKey: ["attendance-subject", id, subjectId],
    queryFn: () => attendanceApi.subject(id, subjectId as number),
    enabled: subjectId != null,
  });

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["attendance-summary", id] }),
      qc.invalidateQueries({ queryKey: ["attendance-subject", id] }),
    ]);
  }

  const remove = useMutation({
    mutationFn: (sessionId: number) => attendanceApi.remove(sessionId),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await attendanceApi.exportXlsx(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance_classroom_${id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  if (summary.isLoading) return <p className="text-sm text-[#44474e]">Loading attendance…</p>;
  if (summary.isError) return <ErrorText message={(summary.error as Error).message} />;
  const subjects = summary.data?.subjects ?? [];
  if (subjects.length === 0) {
    return (
      <EmptyState
        title="No subjects to track"
        body="Attendance is recorded per subject. Subjects you teach in this classroom will appear here."
        icon="fact_check"
      />
    );
  }

  return (
    <div className="space-y-6">
      <ErrorText message={error} />

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[220px]">
            <Field label="Subject">
              <select
                className={inputClass}
                value={subjectId ?? ""}
                onChange={(e) => setSubjectId(Number(e.target.value))}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <SecondaryButton disabled={downloading} onClick={() => void download()}>
            {downloading ? "Preparing…" : "Download Excel"}
          </SecondaryButton>
        </div>
      </Panel>

      {subject.isLoading ? <p className="text-sm text-[#44474e]">Loading lectures…</p> : null}
      {subject.isError ? <ErrorText message={(subject.error as Error).message} /> : null}
      {subject.data ? (
        <SubjectSection
          key={subject.data.subject_id}
          classroomId={id}
          data={subject.data}
          onSaved={refresh}
          onDelete={(sid) => {
            if (window.confirm("Delete this lecture's attendance?")) remove.mutate(sid);
          }}
          setError={setError}
        />
      ) : null}

      <Panel>
        <h3 className="mb-3 font-display text-lg font-bold text-[#031635]">Summary</h3>
        {summary.data && summary.data.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#e1e3e4] text-xs uppercase tracking-wider text-[#75777f]">
                  <th className="py-2 pr-3">Student</th>
                  {summary.data.subjects.map((s) => (
                    <th key={s.id} className="px-3 py-2">
                      {s.code}
                    </th>
                  ))}
                  <th className="px-3 py-2">Final</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.rows.map((r) => (
                  <tr key={r.student_id} className="border-b border-[#e1e3e4] last:border-0">
                    <td className="py-2 pr-3 font-medium text-[#191c1d]">{r.full_name}</td>
                    {summary.data.subjects.map((s) => {
                      const cell = r.subjects.find((x) => x.subject_id === s.id);
                      return (
                        <td key={s.id} className={`px-3 py-2 ${pctTone(cell?.percent)}`}>
                          {pct(cell?.percent)}
                        </td>
                      );
                    })}
                    <td className={`px-3 py-2 font-bold ${pctTone(r.final_percent)}`}>
                      {pct(r.final_percent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[#75777f]">No approved students in this classroom yet.</p>
        )}
      </Panel>
    </div>
  );
}

function SubjectSection({
  classroomId,
  data,
  onSaved,
  onDelete,
  setError,
}: {
  classroomId: number;
  data: {
    subject_id: number;
    can_edit: boolean;
    students: { id: number; full_name: string; email: string }[];
    sessions: AttendanceSession[];
  };
  onSaved: () => Promise<void>;
  onDelete: (sessionId: number) => void;
  setError: (msg: string | null) => void;
}) {
  const [editing, setEditing] = useState<AttendanceSession | null>(null);
  const [heldOn, setHeldOn] = useState(todayIso());
  const [title, setTitle] = useState("");
  const [present, setPresent] = useState<Record<number, boolean>>({});

  const allPresent = useMemo(
    () => Object.fromEntries(data.students.map((s) => [s.id, true])),
    [data.students],
  );

  useEffect(() => {
    setPresent(allPresent);
  }, [allPresent]);

  function resetForm() {
    setEditing(null);
    setHeldOn(todayIso());
    setTitle("");
    setPresent(allPresent);
  }

  function startEdit(s: AttendanceSession) {
    setEditing(s);
    setHeldOn(s.held_on);
    setTitle(s.title);
    setPresent({
      ...Object.fromEntries(data.students.map((st) => [st.id, false])),
      ...Object.fromEntries(s.marks.map((m) => [m.student_id, m.present])),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const save = useMutation({
    mutationFn: () => {
      const marks = data.students.map((s) => ({ student_id: s.id, present: !!present[s.id] }));
      return editing
        ? attendanceApi.update(editing.id, { held_on: heldOn, title, marks })
        : attendanceApi.create(classroomId, data.subject_id, { held_on: heldOn, title, marks });
    },
    onSuccess: async () => {
      setError(null);
      resetForm();
      await onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const presentCount = data.students.filter((s) => present[s.id]).length;

  return (
    <>
      {data.can_edit ? (
        <Panel>
          <h3 className="mb-3 font-display text-lg font-bold text-[#031635]">
            {editing ? "Edit lecture" : "Mark a lecture"}
          </h3>
          {data.students.length === 0 ? (
            <p className="text-sm text-[#75777f]">No approved students to mark yet.</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date">
                  <input
                    type="date"
                    required
                    className={inputClass}
                    value={heldOn}
                    onChange={(e) => setHeldOn(e.target.value)}
                  />
                </Field>
                <Field label="Title (optional)">
                  <input
                    className={inputClass}
                    value={title}
                    maxLength={200}
                    placeholder="e.g. Unit 2 – Lecture 3"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[#75777f]">
                  {presentCount} of {data.students.length} present
                </p>
                <div className="flex gap-2 text-xs font-semibold">
                  <button
                    type="button"
                    className="text-[#3f5d9b] hover:underline"
                    onClick={() => setPresent(allPresent)}
                  >
                    Mark all present
                  </button>
                  <button
                    type="button"
                    className="text-[#3f5d9b] hover:underline"
                    onClick={() =>
                      setPresent(Object.fromEntries(data.students.map((s) => [s.id, false])))
                    }
                  >
                    Mark all absent
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-[#e1e3e4] rounded-lg border border-[#e1e3e4]">
                {data.students.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate text-sm text-[#191c1d]">{s.full_name}</span>
                    <button
                      type="button"
                      aria-pressed={!!present[s.id]}
                      onClick={() => setPresent((p) => ({ ...p, [s.id]: !p[s.id] }))}
                      className={`w-24 shrink-0 rounded-md px-3 py-1 text-xs font-bold transition ${
                        present[s.id]
                          ? "bg-[#e7f3ec] text-[#2f6b4f]"
                          : "bg-[#ffdad6] text-[#ba1a1a]"
                      }`}
                    >
                      {present[s.id] ? "Present" : "Absent"}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <PrimaryButton type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : editing ? "Save changes" : "Save attendance"}
                </PrimaryButton>
                {editing ? <SecondaryButton onClick={resetForm}>Cancel</SecondaryButton> : null}
              </div>
            </form>
          )}
        </Panel>
      ) : (
        <p className="rounded-md border border-[#e1e3e4] bg-[#f8f9fa] px-3.5 py-2.5 text-sm text-[#44474e]">
          View only — attendance for this subject can be marked by its subject teacher.
        </p>
      )}

      <Panel>
        <h3 className="mb-3 font-display text-lg font-bold text-[#031635]">Lectures</h3>
        {data.sessions.length === 0 ? (
          <p className="text-sm text-[#75777f]">No lectures marked yet.</p>
        ) : (
          <ul className="divide-y divide-[#e1e3e4]">
            {data.sessions.map((s) => {
              const total = s.marks.length;
              const here = s.marks.filter((m) => m.present).length;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="text-sm">
                    <span className="font-medium text-[#191c1d]">{s.held_on}</span>
                    {s.title ? <span className="text-[#75777f]"> · {s.title}</span> : null}
                    <span className="ml-2 text-xs text-[#75777f]">
                      {here}/{total} present
                    </span>
                  </div>
                  {data.can_edit ? (
                    <div className="flex gap-3 text-xs font-semibold">
                      <button
                        type="button"
                        className="text-[#3f5d9b] hover:underline"
                        onClick={() => startEdit(s)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-[#ba1a1a] hover:underline"
                        onClick={() => onDelete(s.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
