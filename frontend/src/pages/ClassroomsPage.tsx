import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classroomsApi, institutionsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  Field,
  FormGrid,
  GhostButton,
  inputClass,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../components/ui";

export function ClassroomsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isStudent = user?.role === "STUDENT";
  const canCreate = user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER";
  const isOwner = (classTeacherId: number) =>
    (user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER") && user.id === classTeacherId;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [form, setForm] = useState({
    institution_id: "",
    department_id: "",
    name: "",
    code: "",
    academic_year: "",
    description: "",
  });
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });

  const institutions = useQuery({
    queryKey: ["institutions"],
    queryFn: institutionsApi.list,
    enabled: canCreate,
  });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const pendingJoins = useQuery({
    queryKey: ["my-join-requests"],
    queryFn: classroomsApi.myJoinRequests,
    enabled: isStudent,
  });
  const students = useQuery({
    queryKey: ["classroom-students", selectedId],
    queryFn: () => classroomsApi.listStudents(selectedId!),
    enabled: selectedId != null && !isStudent,
  });
  const joinRequests = useQuery({
    queryKey: ["classroom-join-requests", selectedId],
    queryFn: () => classroomsApi.listJoinRequests(selectedId!),
    enabled: selectedId != null && !!classrooms.data?.find((c) => c.id === selectedId && isOwner(c.class_teacher_id)),
  });
  const announcements = useQuery({
    queryKey: ["classroom-announcements", selectedId],
    queryFn: () => classroomsApi.listAnnouncements(selectedId!),
    enabled: selectedId != null,
  });

  const createClassroom = useMutation({
    mutationFn: classroomsApi.create,
    onSuccess: async (created) => {
      setForm({
        institution_id: "",
        department_id: "",
        name: "",
        code: "",
        academic_year: "",
        description: "",
      });
      setSuccess(`Classroom created. Join code: ${created.join_code}`);
      setSelectedId(created.id);
      await qc.invalidateQueries({ queryKey: ["classrooms"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const joinClassroom = useMutation({
    mutationFn: (code: string) => classroomsApi.join(code),
    onSuccess: async () => {
      setJoinCode("");
      setSuccess("Join request sent. Waiting for teacher approval.");
      await qc.invalidateQueries({ queryKey: ["my-join-requests"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const approveJoin = useMutation({
    mutationFn: ({ id, studentId }: { id: number; studentId: number }) => classroomsApi.approveJoin(id, studentId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["classroom-join-requests", selectedId] }),
        qc.invalidateQueries({ queryKey: ["classroom-students", selectedId] }),
      ]);
    },
    onError: (err: Error) => setError(err.message),
  });

  const rejectJoin = useMutation({
    mutationFn: ({ id, studentId }: { id: number; studentId: number }) => classroomsApi.rejectJoin(id, studentId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["classroom-join-requests", selectedId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeStudent = useMutation({
    mutationFn: ({ id, studentId }: { id: number; studentId: number }) =>
      classroomsApi.removeStudent(id, studentId),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["classroom-students", selectedId] }),
  });

  const createAnnouncement = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { title: string; body: string } }) =>
      classroomsApi.createAnnouncement(id, body),
    onSuccess: async () => {
      setAnnouncement({ title: "", body: "" });
      await qc.invalidateQueries({ queryKey: ["classroom-announcements", selectedId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deactivate = useMutation({
    mutationFn: classroomsApi.deactivate,
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["classrooms"] }),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    createClassroom.mutate({
      institution_id: Number(form.institution_id || user?.institution_id),
      department_id: form.department_id ? Number(form.department_id) : user?.department_id ?? null,
      name: form.name,
      code: form.code,
      academic_year: form.academic_year || undefined,
      description: form.description || undefined,
    });
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    joinClassroom.mutate(joinCode.trim().toUpperCase());
  }

  const selected = classrooms.data?.find((c) => c.id === selectedId);
  const selectedIsOwned = selected ? isOwner(selected.class_teacher_id) : false;

  if (isStudent) {
    return (
      <div>
        <PageHeader
          title="Classrooms"
          subtitle="Enter the 5-character join code from your teacher. Access starts after approval."
        />
        <ErrorText message={error} />
        {success ? (
          <p className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">{success}</p>
        ) : null}

        <Panel className="mb-6">
          <h2 className="mb-4 font-display text-xl text-paper">Join a classroom</h2>
          <form onSubmit={onJoin} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Join code">
                <input
                  className={`${inputClass} uppercase tracking-[0.3em]`}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
                  maxLength={5}
                  minLength={5}
                  pattern="[A-Za-z0-9]{5}"
                  placeholder="AB12C"
                  required
                />
              </Field>
            </div>
            <PrimaryButton type="submit" disabled={joinClassroom.isPending}>
              Request to join
            </PrimaryButton>
          </form>
        </Panel>

        {pendingJoins.data?.length ? (
          <Panel className="mb-6">
            <h2 className="mb-4 font-display text-xl text-paper">Pending requests</h2>
            <ul className="space-y-2">
              {pendingJoins.data.map((r) => (
                <li key={r.id} className="rounded-xl border border-line px-3 py-2 text-sm text-mist">
                  <span className="text-paper">{r.classroom_name ?? `Classroom ${r.classroom_id}`}</span>
                  {r.classroom_code ? ` (${r.classroom_code})` : ""} · awaiting approval
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel>
          <h2 className="mb-4 font-display text-xl text-paper">Your classrooms</h2>
          {!classrooms.data?.length ? (
            <EmptyState title="No classrooms yet" body="Ask your teacher for a join code to get started." />
          ) : (
            <div className="space-y-3">
              {classrooms.data.map((c) => (
                <div key={c.id} className="rounded-2xl border border-line bg-ink-soft/40 px-4 py-3">
                  <p className="font-semibold text-paper">
                    {c.name} <span className="text-mist">({c.code})</span>
                  </p>
                  <p className="mt-1 text-xs text-mist">Year: {c.academic_year || "—"}</p>
                  {c.description ? <p className="mt-2 text-sm text-mist">{c.description}</p> : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Classrooms"
        subtitle="Create classrooms, share the join code, and approve student requests."
      />
      <ErrorText message={error} />
      {success ? (
        <p className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">{success}</p>
      ) : null}

      {canCreate ? (
        <Panel className="mb-6">
          <h2 className="mb-4 font-display text-xl text-paper">Create classroom</h2>
          <FormGrid onSubmit={onCreate}>
            <Field label="Institution ID">
              <input
                className={inputClass}
                list="institution-options"
                value={form.institution_id || String(user?.institution_id ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, institution_id: e.target.value }))}
                required
              />
              <datalist id="institution-options">
                {institutions.data?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Department ID (optional)">
              <input
                className={inputClass}
                value={form.department_id || String(user?.department_id ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}
              />
            </Field>
            <Field label="Name">
              <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Class label">
              <input className={inputClass} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
            </Field>
            <Field label="Academic year">
              <input
                className={inputClass}
                value={form.academic_year}
                onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))}
                placeholder="2026-27"
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <textarea
                  className={inputClass}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                />
              </Field>
            </div>
            <div className="flex items-end">
              <PrimaryButton type="submit" disabled={createClassroom.isPending}>
                Create classroom
              </PrimaryButton>
            </div>
          </FormGrid>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <h2 className="mb-4 font-display text-xl text-paper">Your classrooms</h2>
          {!classrooms.data?.length ? (
            <EmptyState title="No classrooms" body="Classrooms you can access will appear here." />
          ) : (
            <div className="space-y-3">
              {classrooms.data.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-2xl border px-4 py-3 ${
                    selectedId === c.id ? "border-accent/50 bg-accent/5" : "border-line bg-ink-soft/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="text-left" onClick={() => setSelectedId(c.id)}>
                      <p className="font-semibold text-paper">
                        {c.name} <span className="text-mist">({c.code})</span>
                      </p>
                      <p className="text-xs text-mist">
                        Join code <span className="font-semibold tracking-widest text-accent">{c.join_code}</span>
                        {" · "}
                        {c.is_active ? "Active" : "Inactive"}
                      </p>
                    </button>
                    {isOwner(c.class_teacher_id) && c.is_active ? (
                      <GhostButton onClick={() => deactivate.mutate(c.id)}>Deactivate</GhostButton>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-4 font-display text-xl text-paper">Classroom detail</h2>
          {!selected ? (
            <EmptyState title="Select a classroom" body="Pick a classroom to manage join requests and announcements." />
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-paper">{selected.description || "No description"}</p>
                <p className="mt-1 text-xs text-mist">Year: {selected.academic_year || "—"}</p>
                {selectedIsOwned ? (
                  <p className="mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
                    Share join code:{" "}
                    <span className="font-display text-lg tracking-[0.25em] text-accent">{selected.join_code}</span>
                  </p>
                ) : null}
              </div>

              {selectedIsOwned ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Pending join requests</h3>
                  {!joinRequests.data?.length ? (
                    <p className="text-sm text-mist">No pending requests.</p>
                  ) : (
                    <ul className="space-y-2">
                      {joinRequests.data.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                          <span>
                            <span className="text-paper">{r.student_full_name ?? `Student ${r.student_id}`}</span>
                            <span className="text-mist"> · {r.student_email}</span>
                          </span>
                          <div className="flex gap-2">
                            <PrimaryButton
                              onClick={() => approveJoin.mutate({ id: selected.id, studentId: r.student_id })}
                            >
                              Approve
                            </PrimaryButton>
                            <GhostButton onClick={() => rejectJoin.mutate({ id: selected.id, studentId: r.student_id })}>
                              Reject
                            </GhostButton>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Students</h3>
                {!students.data?.length ? (
                  <p className="text-sm text-mist">No approved students yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {students.data.map((s) => (
                      <li key={s.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
                        <span>
                          {s.student_full_name ?? `Student ${s.student_id}`}
                          <span className="text-mist">{s.student_email ? ` · ${s.student_email}` : ""}</span>
                        </span>
                        {selectedIsOwned ? (
                          <GhostButton onClick={() => removeStudent.mutate({ id: selected.id, studentId: s.student_id })}>
                            Remove
                          </GhostButton>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedIsOwned ? (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError(null);
                    createAnnouncement.mutate({ id: selected.id, body: announcement });
                  }}
                >
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
                      rows={3}
                      value={announcement.body}
                      onChange={(e) => setAnnouncement((a) => ({ ...a, body: e.target.value }))}
                      required
                    />
                  </Field>
                  <PrimaryButton type="submit">Post announcement</PrimaryButton>
                </form>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Announcements</h3>
                {!announcements.data?.length ? (
                  <p className="text-sm text-mist">No announcements yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {announcements.data.map((a) => (
                      <li key={a.id} className="rounded-xl border border-line px-3 py-2">
                        <p className="font-medium text-paper">{a.title}</p>
                        <p className="text-sm text-mist">{a.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
