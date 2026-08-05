import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { institutionsApi, usersApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../api/types";
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

type HodCreateRole = "CLASS_TEACHER" | "SUBJECT_TEACHER";

export function TeamPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    department_id: "",
    member_role: "CLASS_TEACHER" as HodCreateRole,
  });

  const canManage = user?.role === "INSTITUTION_ADMIN" || user?.role === "HOD";

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
        department_id: "",
        member_role: "CLASS_TEACHER",
      });
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleCoding = useMutation({
    mutationFn: ({ userId, enabled }: { userId: number; enabled: boolean }) =>
      usersApi.setCodingPlatform(userId, enabled),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

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
        role: form.member_role as UserRole,
      });
    }
  }

  const createTitle =
    user?.role === "INSTITUTION_ADMIN"
      ? "Create head of department"
      : user?.role === "HOD"
        ? "Create teacher"
        : "";

  const createHint =
    user?.role === "INSTITUTION_ADMIN"
      ? "HODs manage teachers in their department."
      : user?.role === "HOD"
        ? "Teachers create classrooms and approve join requests. Students self-register and join with a code."
        : "";

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Team" subtitle="User provisioning is managed by administrators." />
        <Panel>
          <EmptyState
            title="No access"
            body="Institution admins and HODs manage team members here. Super Admins create institution admins from Institutions."
          />
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
            <Field label="Account type">
              <select
                className={inputClass}
                value={form.member_role}
                onChange={(e) => setForm((f) => ({ ...f, member_role: e.target.value as HodCreateRole }))}
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
            {members.data.map((m) => {
              const isTeacher = m.role === "CLASS_TEACHER" || m.role === "SUBJECT_TEACHER";
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium text-paper">{m.full_name}</span>
                    <span className="text-mist">
                      {" "}
                      · {m.email} · {roleLabel[m.role] ?? m.role}
                      {m.department_id ? ` · Dept ${m.department_id}` : ""}
                    </span>
                  </div>
                  {user?.role === "HOD" && isTeacher ? (
                    <label className="flex items-center gap-2 text-xs text-mist">
                      <span>Coding platform</span>
                      <input
                        type="checkbox"
                        checked={!!m.coding_platform_enabled}
                        disabled={toggleCoding.isPending}
                        onChange={(e) =>
                          toggleCoding.mutate({ userId: m.id, enabled: e.target.checked })
                        }
                      />
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
