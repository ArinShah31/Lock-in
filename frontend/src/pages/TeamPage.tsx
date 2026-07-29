import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { institutionsApi, usersApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  ErrorText,
  Field,
  FormGrid,
  inputClass,
  PageHeader,
  Panel,
  PrimaryButton,
} from "../components/ui";

const roleLabel: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  INSTITUTION_ADMIN: "Institution Admin",
  HOD: "Head of Department",
  CLASS_TEACHER: "Class Teacher",
  SUBJECT_TEACHER: "Subject Teacher",
  STUDENT: "Student",
};

export function TeamPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    institution_id: "",
    department_id: "",
    teacher_role: "CLASS_TEACHER" as "CLASS_TEACHER" | "SUBJECT_TEACHER",
  });

  const canManage =
    user?.role === "SUPER_ADMIN" || user?.role === "INSTITUTION_ADMIN" || user?.role === "HOD";

  const institutions = useQuery({
    queryKey: ["institutions"],
    queryFn: institutionsApi.list,
    enabled: user?.role === "SUPER_ADMIN",
  });

  const departments = useQuery({
    queryKey: ["departments", user?.institution_id],
    queryFn: () => institutionsApi.listDepartments(user!.institution_id!),
    enabled: user?.role === "INSTITUTION_ADMIN" && !!user.institution_id,
  });

  const members = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
    enabled: canManage,
  });

  const createUser = useMutation({
    mutationFn: usersApi.create,
    onSuccess: async () => {
      setForm({
        full_name: "",
        email: "",
        password: "",
        institution_id: "",
        department_id: "",
        teacher_role: "CLASS_TEACHER",
      });
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (user?.role === "SUPER_ADMIN") {
      createUser.mutate({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        role: "INSTITUTION_ADMIN",
        institution_id: Number(form.institution_id),
      });
      return;
    }

    if (user?.role === "INSTITUTION_ADMIN") {
      createUser.mutate({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        role: "HOD",
        department_id: Number(form.department_id),
      });
      return;
    }

    if (user?.role === "HOD") {
      createUser.mutate({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        role: form.teacher_role,
      });
    }
  }

  const createTitle =
    user?.role === "SUPER_ADMIN"
      ? "Create institution admin"
      : user?.role === "INSTITUTION_ADMIN"
        ? "Create head of department"
        : user?.role === "HOD"
          ? "Create teacher"
          : "";

  const createHint =
    user?.role === "SUPER_ADMIN"
      ? "Assign an admin to manage departments for an institution."
      : user?.role === "INSTITUTION_ADMIN"
        ? "HODs manage teachers in their department."
        : user?.role === "HOD"
          ? "Teachers can create classrooms and manage subjects."
          : "";

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Team" subtitle="User provisioning is managed by administrators." />
        <Panel>
          <EmptyState title="No access" body="Only Super Admin, Institution Admin, or HOD can manage team members." />
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Team" subtitle="Provision accounts along the institution hierarchy." />
      <ErrorText message={error} />

      <Panel className="mb-6">
        <h2 className="mb-1 font-display text-xl text-paper">{createTitle}</h2>
        <p className="mb-4 text-sm text-mist">{createHint}</p>
        <FormGrid onSubmit={onSubmit}>
          <Field label="Full name">
            <input
              className={inputClass}
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </Field>
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
            />
          </Field>

          {user?.role === "SUPER_ADMIN" ? (
            <Field label="Institution">
              <select
                className={inputClass}
                value={form.institution_id}
                onChange={(e) => setForm((f) => ({ ...f, institution_id: e.target.value }))}
                required
              >
                <option value="">Select institution</option>
                {institutions.data?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.code})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {user?.role === "INSTITUTION_ADMIN" ? (
            <Field label="Department">
              <select
                className={inputClass}
                value={form.department_id}
                onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}
                required
              >
                <option value="">Select department</option>
                {departments.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {user?.role === "HOD" ? (
            <Field label="Teacher type">
              <select
                className={inputClass}
                value={form.teacher_role}
                onChange={(e) =>
                  setForm((f) => ({ ...f, teacher_role: e.target.value as "CLASS_TEACHER" | "SUBJECT_TEACHER" }))
                }
              >
                <option value="CLASS_TEACHER">Class Teacher</option>
                <option value="SUBJECT_TEACHER">Subject Teacher</option>
              </select>
            </Field>
          ) : null}

          <div className="flex items-end">
            <PrimaryButton type="submit" disabled={createUser.isPending}>
              Create account
            </PrimaryButton>
          </div>
        </FormGrid>
      </Panel>

      <Panel>
        <h2 className="mb-4 font-display text-xl text-paper">Team members</h2>
        {!members.data?.length ? (
          <EmptyState title="No members yet" body="Created accounts will appear here." />
        ) : (
          <ul className="space-y-2">
            {members.data.map((m) => (
              <li key={m.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                <span className="font-medium text-paper">{m.full_name}</span>
                <span className="text-mist">
                  {" "}
                  · {m.email} · {roleLabel[m.role] ?? m.role}
                  {m.department_id ? ` · Dept ${m.department_id}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
