import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { classroomsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import {
  ErrorText,
  Field,
  FormGrid,
  inputClass,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../components/ui";

export function CreateClassroomPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canCreate = user?.role === "CLASS_TEACHER" || user?.role === "SUBJECT_TEACHER";
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    academic_year: "",
    description: "",
  });

  const createClassroom = useMutation({
    mutationFn: classroomsApi.create,
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ["classrooms"] });
      navigate(`/classrooms/${created.id}/details`, {
        replace: true,
        state: {
          success: `Classroom created. Join code: ${created.join_code}`,
        },
      });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!canCreate) {
    return <Navigate to="/classrooms" replace />;
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user?.institution_id) {
      setError("Your account has no institution assigned. Ask your HOD or admin to fix this.");
      return;
    }
    createClassroom.mutate({
      institution_id: user.institution_id,
      department_id: user.department_id ?? null,
      name: form.name,
      code: form.code,
      academic_year: form.academic_year || undefined,
      description: form.description || undefined,
    });
  }

  return (
    <div>
      <PageHeader
        title="Create classroom"
        subtitle="Institution and department are taken from your account. A unique 5-character join code is generated automatically."
      />
      <ErrorText message={error} />

      <Panel>
        <FormGrid onSubmit={onCreate}>
          <Field label="Name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </Field>
          <Field label="Class label">
            <input
              className={inputClass}
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              required
            />
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
          <div className="flex items-end gap-3">
            <PrimaryButton type="submit" disabled={createClassroom.isPending}>
              Create classroom
            </PrimaryButton>
          </div>
        </FormGrid>
      </Panel>
    </div>
  );
}
