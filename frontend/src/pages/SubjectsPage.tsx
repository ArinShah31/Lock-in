import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classroomsApi, subjectsApi } from "../api";
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

export function SubjectsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canCreate = user?.role === "SUPER_ADMIN" || user?.role === "CLASS_TEACHER";

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    classroom_id: "",
    teacher_id: "",
    name: "",
    code: "",
    description: "",
  });
  const [syllabus, setSyllabus] = useState("");
  const [material, setMaterial] = useState({ title: "", content_text: "", material_type: "NOTE" });

  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: classroomsApi.list });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: subjectsApi.list });
  const materials = useQuery({
    queryKey: ["subject-materials", selectedId],
    queryFn: () => subjectsApi.listMaterials(selectedId!),
    enabled: selectedId != null,
  });

  const createSubject = useMutation({
    mutationFn: subjectsApi.create,
    onSuccess: async () => {
      setForm({ classroom_id: "", teacher_id: "", name: "", code: "", description: "" });
      await qc.invalidateQueries({ queryKey: ["subjects"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateSubject = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => subjectsApi.update(id, body),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["subjects"] }),
    onError: (err: Error) => setError(err.message),
  });

  const updateSyllabus = useMutation({
    mutationFn: ({ id, syllabus_text }: { id: number; syllabus_text: string }) =>
      subjectsApi.updateSyllabus(id, { syllabus_text }),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["subjects"] }),
    onError: (err: Error) => setError(err.message),
  });

  const addMaterial = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: { title: string; content_text?: string; material_type?: string };
    }) => subjectsApi.addMaterial(id, body),
    onSuccess: async () => {
      setMaterial({ title: "", content_text: "", material_type: "NOTE" });
      await qc.invalidateQueries({ queryKey: ["subject-materials", selectedId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createSubject.mutate({
      classroom_id: Number(form.classroom_id),
      teacher_id: Number(form.teacher_id),
      name: form.name,
      code: form.code,
      description: form.description || undefined,
    });
  }

  const selected = subjects.data?.find((s) => s.id === selectedId);
  const canEditSelected =
    !!selected && (user?.role === "SUPER_ADMIN" || user?.role === "CLASS_TEACHER" || user?.id === selected.teacher_id);

  return (
    <div>
      <PageHeader
        title="Subjects"
        subtitle="Assign teachers, publish subjects, and manage syllabus materials."
        action={
          <Link
            to="/course-builder"
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-accent-deep"
          >
            Open AI Course Builder
          </Link>
        }
      />
      <ErrorText message={error} />

      {canCreate ? (
        <Panel className="mb-6">
          <h2 className="mb-4 font-display text-xl text-paper">Create subject</h2>
          <FormGrid onSubmit={onCreate}>
            <Field label="Classroom ID">
              <input
                className={inputClass}
                list="classroom-options"
                value={form.classroom_id}
                onChange={(e) => setForm((f) => ({ ...f, classroom_id: e.target.value }))}
                required
              />
              <datalist id="classroom-options">
                {classrooms.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Subject teacher user ID">
              <input
                className={inputClass}
                value={form.teacher_id}
                onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}
                required
              />
            </Field>
            <Field label="Name">
              <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Code">
              <input className={inputClass} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex items-end">
              <PrimaryButton type="submit" disabled={createSubject.isPending}>
                Create subject
              </PrimaryButton>
            </div>
          </FormGrid>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <h2 className="mb-4 font-display text-xl text-paper">Subjects</h2>
          {!subjects.data?.length ? (
            <EmptyState title="No subjects" body="Subjects you can access will show up here." />
          ) : (
            <div className="space-y-3">
              {subjects.data.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id);
                    setSyllabus(s.syllabus_text ?? "");
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left ${
                    selectedId === s.id ? "border-accent/50 bg-accent/5" : "border-line bg-ink-soft/40"
                  }`}
                >
                  <p className="font-semibold text-paper">
                    {s.name} <span className="text-mist">({s.code})</span>
                  </p>
                  <p className="text-xs text-mist">
                    Classroom {s.classroom_id} · Teacher {s.teacher_id} ·{" "}
                    {s.is_published ? "Published" : "Draft"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-4 font-display text-xl text-paper">Subject workspace</h2>
          {!selected ? (
            <EmptyState title="Select a subject" body="Open a subject to edit syllabus and materials." />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {(user?.role === "SUPER_ADMIN" ||
                  user?.role === "CLASS_TEACHER" ||
                  user?.id === selected.teacher_id) && (
                  <PrimaryButton
                    onClick={() =>
                      updateSubject.mutate({
                        id: selected.id,
                        body: { is_published: !selected.is_published },
                      })
                    }
                  >
                    {selected.is_published ? "Unpublish" : "Publish"}
                  </PrimaryButton>
                )}
                <GhostButton onClick={() => setSelectedId(null)}>Close</GhostButton>
              </div>

              <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
                <p className="font-display text-lg text-paper">AI Course Content</p>
                <p className="mt-1 text-sm text-mist">
                  Roadmaps, flashcards, quizzes, and assessments are managed in Course Builder — not stacked here.
                </p>
                <Link
                  to="/course-builder"
                  className="mt-3 inline-flex rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-accent-deep"
                >
                  Go to Course Builder
                </Link>
              </div>

              {(user?.role === "SUPER_ADMIN" ||
                user?.role === "CLASS_TEACHER" ||
                user?.id === selected.teacher_id) && (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError(null);
                    updateSyllabus.mutate({ id: selected.id, syllabus_text: syllabus });
                  }}
                >
                  <Field label="Syllabus">
                    <textarea
                      className={inputClass}
                      rows={5}
                      value={syllabus}
                      onChange={(e) => setSyllabus(e.target.value)}
                    />
                  </Field>
                  <PrimaryButton type="submit">Save syllabus</PrimaryButton>
                </form>
              )}

              {selected.syllabus_text && !canEditSelected ? (
                <div className="rounded-xl border border-line bg-ink-soft/50 p-3 text-sm text-mist whitespace-pre-wrap">
                  {selected.syllabus_text}
                </div>
              ) : null}

              {canEditSelected ? (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError(null);
                    addMaterial.mutate({
                      id: selected.id,
                      body: {
                        title: material.title,
                        content_text: material.content_text,
                        material_type: material.material_type,
                      },
                    });
                  }}
                >
                  <Field label="Material title">
                    <input
                      className={inputClass}
                      value={material.title}
                      onChange={(e) => setMaterial((m) => ({ ...m, title: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label="Content">
                    <textarea
                      className={inputClass}
                      rows={3}
                      value={material.content_text}
                      onChange={(e) => setMaterial((m) => ({ ...m, content_text: e.target.value }))}
                      required
                    />
                  </Field>
                  <PrimaryButton type="submit">Add material</PrimaryButton>
                </form>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-mist">Materials</h3>
                {!materials.data?.length ? (
                  <p className="text-sm text-mist">No materials yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {materials.data.map((m) => (
                      <li key={m.id} className="rounded-xl border border-line px-3 py-2">
                        <p className="font-medium text-paper">
                          {m.title} <span className="text-xs text-mist">({m.material_type})</span>
                        </p>
                        {m.content_text ? <p className="text-sm text-mist">{m.content_text}</p> : null}
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
