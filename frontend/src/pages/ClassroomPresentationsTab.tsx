import { FormEvent, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { presentationsApi } from "../api";
import type { Classroom, ClassroomPresentation } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorText, Field, GhostButton, PrimaryButton, inputClass } from "../components/ui";

type OutletCtx = { classroom: Classroom };

const TEACHER_ROLES = new Set(["CLASS_TEACHER", "SUBJECT_TEACHER", "SUPER_ADMIN"]);

function statusLabel(status: ClassroomPresentation["status"]) {
  if (status === "PREPARING") return "Preparing slides";
  if (status === "GENERATING") return "Generating video";
  if (status === "VIDEO_READY") return "Video ready";
  if (status === "AUDIO_READY") return "Voiceover ready";
  if (status === "SCRIPTS_READY") return "Scripts ready";
  if (status === "FAILED") return "Failed";
  return "Uploaded";
}

export function ClassroomPresentationsTab() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId } = useParams();
  const id = Number(classroomId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const canManage = !!user && TEACHER_ROLES.has(user.role);

  const list = useQuery({
    queryKey: ["presentations", id],
    queryFn: () => presentationsApi.list(id),
    enabled: !Number.isNaN(id),
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "GENERATING" || item.status === "PREPARING")
        ? 3000
        : false,
  });

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a .pptx file");
      return presentationsApi.upload(id, title.trim() || file.name.replace(/\.pptx$/i, ""), file);
    },
    onSuccess: async () => {
      setTitle("");
      setFile(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["presentations", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (presentationId: number) => presentationsApi.remove(id, presentationId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["presentations", id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const items = useMemo(() => list.data ?? [], [list.data]);

  function onUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    upload.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-extrabold text-[#031635]">Presentations</h2>
        <p className="mt-1 text-sm text-[#75777f]">
          {canManage
            ? "Upload a PowerPoint. ASTRA renders the original slides and writes teaching narration, then you can generate the video."
            : "Open a presentation to watch the narrated video, or download the original PowerPoint."}
        </p>
      </div>

      <ErrorText message={error} />

      {canManage ? (
        <form
          className="grid gap-3 rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={onUpload}
        >
          <Field label="Title">
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lecture 3 — Pointers"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="PowerPoint (.pptx)">
              <input
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-[#44474e]"
              />
            </Field>
          </div>
          <PrimaryButton type="submit" disabled={upload.isPending || !file}>
            {upload.isPending ? "Uploading…" : "Upload presentation"}
          </PrimaryButton>
        </form>
      ) : null}

      {list.isLoading ? (
        <p className="text-sm text-[#75777f]">Loading presentations…</p>
      ) : !items.length ? (
        <EmptyState
          title="No presentations yet"
          body={
            canManage
              ? "Upload a .pptx, then generate a narrated video of the original slides."
              : "Your teacher has not published a presentation for this classroom yet."
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded-xl border border-[#e1e3e4] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-[#031635]">{item.title}</p>
                <p className="text-xs text-[#75777f]">
                  {item.file_name} · {item.slide_count} slide{item.slide_count === 1 ? "" : "s"} ·{" "}
                  {item.has_video && item.status !== "GENERATING" && item.status !== "PREPARING"
                    ? "Video ready"
                    : statusLabel(item.status)}
                  {item.status === "GENERATING" || item.status === "PREPARING"
                    ? item.progress_message
                      ? ` · ${item.progress_message}`
                      : ""
                    : ""}
                </p>
                {item.status === "FAILED" && item.error_message ? (
                  <p className="mt-1 text-xs text-[#a03a3a]">{item.error_message}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton
                  onClick={() =>
                    navigate(`/classrooms/${id}/presentations/${item.id}`, {
                      state: { classroom },
                    })
                  }
                >
                  Open
                </PrimaryButton>
                <GhostButton onClick={() => void presentationsApi.download(id, item.id, item.file_name)}>
                  Download
                </GhostButton>
                {canManage ? (
                  <GhostButton onClick={() => remove.mutate(item.id)} disabled={remove.isPending}>
                    Delete
                  </GhostButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
