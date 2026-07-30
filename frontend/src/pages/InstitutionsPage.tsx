import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { institutionsApi, usersApi } from "../api";
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

export function InstitutionsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deptName, setDeptName] = useState("");
  const [deptCode, setDeptCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [adminForm, setAdminForm] = useState({
    full_name: "",
    email: "",
    password: "",
    institution_id: "",
  });
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);

  const list = useQuery({ queryKey: ["institutions"], queryFn: institutionsApi.list });
  const departments = useQuery({
    queryKey: ["departments", selectedId],
    queryFn: () => institutionsApi.listDepartments(selectedId!),
    enabled: selectedId != null,
  });

  const createInstitution = useMutation({
    mutationFn: institutionsApi.create,
    onSuccess: async () => {
      setName("");
      setCode("");
      setAddress("");
      await qc.invalidateQueries({ queryKey: ["institutions"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const createDepartment = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name: string; code: string } }) =>
      institutionsApi.createDepartment(id, body),
    onSuccess: async () => {
      setDeptName("");
      setDeptCode("");
      await qc.invalidateQueries({ queryKey: ["departments", selectedId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const createAdmin = useMutation({
    mutationFn: usersApi.create,
    onSuccess: async (_data, variables) => {
      setAdminForm({ full_name: "", email: "", password: "", institution_id: "" });
      setShowAdminForm(false);
      setAdminSuccess(`Institution admin created for ${variables.email}`);
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deactivate = useMutation({
    mutationFn: institutionsApi.deactivate,
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["institutions"] }),
  });

  function onCreateInstitution(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAdminSuccess(null);
    createInstitution.mutate({ name, code, address: address || undefined });
  }

  function onCreateDepartment(e: FormEvent) {
    e.preventDefault();
    if (selectedId == null) return;
    setError(null);
    createDepartment.mutate({ id: selectedId, body: { name: deptName, code: deptCode } });
  }

  function openAdminForm() {
    setError(null);
    setAdminSuccess(null);
    setAdminForm((f) => ({
      ...f,
      institution_id: selectedId != null ? String(selectedId) : f.institution_id,
    }));
    setShowAdminForm(true);
  }

  function onCreateAdmin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAdminSuccess(null);
    createAdmin.mutate({
      full_name: adminForm.full_name,
      email: adminForm.email,
      password: adminForm.password,
      role: "INSTITUTION_ADMIN",
      institution_id: Number(adminForm.institution_id),
    });
  }

  return (
    <div>
      <PageHeader
        title="Institutions"
        subtitle={
          user?.role === "SUPER_ADMIN"
            ? "Create institutions and assign institution admins."
            : "Institution Admins manage departments and HODs."
        }
        action={
          user?.role === "SUPER_ADMIN" ? (
            <PrimaryButton onClick={openAdminForm}>+ Create admin</PrimaryButton>
          ) : undefined
        }
      />

      <ErrorText message={error} />
      {adminSuccess ? (
        <p className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">{adminSuccess}</p>
      ) : null}

      {user?.role === "SUPER_ADMIN" && showAdminForm ? (
        <Panel className="mb-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-paper">Create institution admin</h2>
              <p className="mt-1 text-sm text-mist">Assign an admin to manage departments for an institution.</p>
            </div>
            <GhostButton onClick={() => setShowAdminForm(false)}>Close</GhostButton>
          </div>
          <FormGrid onSubmit={onCreateAdmin}>
            <Field label="Full name">
              <input
                className={inputClass}
                value={adminForm.full_name}
                onChange={(e) => setAdminForm((f) => ({ ...f, full_name: e.target.value }))}
                required
              />
            </Field>
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                value={adminForm.email}
                onChange={(e) => setAdminForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                value={adminForm.password}
                onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
              />
            </Field>
            <Field label="Institution">
              <select
                className={inputClass}
                value={adminForm.institution_id}
                onChange={(e) => setAdminForm((f) => ({ ...f, institution_id: e.target.value }))}
                required
              >
                <option value="">Select institution</option>
                {list.data?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.code})
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <PrimaryButton type="submit" disabled={createAdmin.isPending}>
                Create admin
              </PrimaryButton>
            </div>
          </FormGrid>
        </Panel>
      ) : null}

      {user?.role === "SUPER_ADMIN" ? (
        <Panel className="mb-6">
          <h2 className="mb-4 font-display text-xl text-paper">Create institution</h2>
          <FormGrid onSubmit={onCreateInstitution}>
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Code">
              <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} required />
            </Field>
            <Field label="Address">
              <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <PrimaryButton type="submit" disabled={createInstitution.isPending}>
                Create
              </PrimaryButton>
            </div>
          </FormGrid>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <h2 className="mb-4 font-display text-xl text-paper">All institutions</h2>
          {!list.data?.length ? (
            <EmptyState title="No institutions" body="Super Admin can create the first institution." />
          ) : (
            <div className="space-y-3">
              {list.data.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border px-4 py-3 transition ${
                    selectedId === item.id ? "border-accent/50 bg-accent/5" : "border-line bg-ink-soft/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="text-left" onClick={() => setSelectedId(item.id)}>
                      <p className="font-semibold text-paper">
                        {item.name} <span className="text-mist">({item.code})</span>
                      </p>
                      <p className="text-xs text-mist">ID {item.id} · {item.is_active ? "Active" : "Inactive"}</p>
                      {item.address ? <p className="mt-1 text-sm text-mist">{item.address}</p> : null}
                    </button>
                    {user?.role === "SUPER_ADMIN" && item.is_active ? (
                      <GhostButton onClick={() => deactivate.mutate(item.id)}>Deactivate</GhostButton>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-4 font-display text-xl text-paper">Departments</h2>
          {selectedId == null ? (
            <EmptyState title="Select an institution" body="Choose an institution to view or add departments." />
          ) : (
            <>
              {user?.role === "INSTITUTION_ADMIN" ? (
                <form onSubmit={onCreateDepartment} className="mb-4 grid gap-3">
                  <Field label="Department name">
                    <input className={inputClass} value={deptName} onChange={(e) => setDeptName(e.target.value)} required />
                  </Field>
                  <Field label="Department code">
                    <input className={inputClass} value={deptCode} onChange={(e) => setDeptCode(e.target.value)} required />
                  </Field>
                  <PrimaryButton type="submit" disabled={createDepartment.isPending}>
                    Add department
                  </PrimaryButton>
                </form>
              ) : null}

              {!departments.data?.length ? (
                <EmptyState title="No departments" body="Institution admins can add departments like CSE or ECE." />
              ) : (
                <ul className="space-y-2">
                  {departments.data.map((d) => (
                    <li key={d.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                      <span className="text-paper">{d.name}</span>
                      <span className="text-mist"> · {d.code} · ID {d.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
