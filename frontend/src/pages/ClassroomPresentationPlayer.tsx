import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { presentationsApi } from "../api";
import type { Classroom } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, GhostButton, PrimaryButton, inputClass } from "../components/ui";

type OutletCtx = { classroom: Classroom };
const TEACHER_ROLES = new Set(["CLASS_TEACHER", "SUBJECT_TEACHER", "SUPER_ADMIN"]);

function useAuthBlob(path: string | null, enabled: boolean, timeoutMs?: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !path) {
      setUrl(null);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    void presentationsApi
      .fetchBlob(path, timeoutMs)
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [path, enabled, timeoutMs]);
  return url;
}

export function ClassroomPresentationPlayer() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId, presentationId } = useParams();
  const cid = Number(classroomId);
  const pid = Number(presentationId);
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user && TEACHER_ROLES.has(user.role);

  const [slidePos, setSlidePos] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["presentation", cid, pid],
    queryFn: () => presentationsApi.get(cid, pid),
    enabled: !Number.isNaN(cid) && !Number.isNaN(pid),
  });

  const slides = detail.data?.slides ?? [];
  const slide = slides[slidePos] ?? null;
  const hasVideo = Boolean(detail.data?.has_video) || detail.data?.status === "VIDEO_READY";
  const videoUrl = useAuthBlob(
    hasVideo ? presentationsApi.videoUrl(cid, pid) : null,
    hasVideo,
    180_000,
  );

  useEffect(() => {
    setDraft(slide?.script ?? "");
  }, [slide?.id]);

  const saveSlide = useMutation({
    mutationFn: () => presentationsApi.patchSlide(cid, pid, slide!.id, draft),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["presentation", cid, pid] });
      await qc.invalidateQueries({ queryKey: ["presentations", cid] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const generateVideo = useMutation({
    mutationFn: () => presentationsApi.generateVideo(cid, pid),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["presentation", cid, pid] });
      await qc.invalidateQueries({ queryKey: ["presentations", cid] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (detail.isLoading) {
    return <p className="text-sm text-[#75777f]">Loading presentation…</p>;
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-3">
        <ErrorText message={detail.error instanceof Error ? detail.error.message : "Not found"} />
        <Link to={`/classrooms/${cid}/presentations`} className="text-sm font-semibold text-[#3f5d9b]">
          ← Back to presentations
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/classrooms/${cid}/presentations`} className="text-xs font-semibold text-[#3f5d9b]">
            ← Presentations
          </Link>
          <h2 className="mt-1 font-display text-xl font-extrabold text-[#031635]">{detail.data.title}</h2>
          <p className="text-xs text-[#75777f]">
            {classroom.name} · {slides.length} slide{slides.length === 1 ? "" : "s"} · original PPTX kept
          </p>
        </div>
        <GhostButton onClick={() => void presentationsApi.download(cid, pid, detail.data.file_name)}>
          Download original PPTX
        </GhostButton>
      </div>

      <ErrorText message={error || detail.data.error_message} />

      {videoUrl ? (
        <video
          className="aspect-video w-full rounded-xl border border-[#d8dde3] bg-black"
          src={videoUrl}
          controls
          playsInline
        />
      ) : hasVideo ? (
        <p className="text-sm text-[#75777f]">Loading narrated video…</p>
      ) : (
        <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4 text-sm text-[#44474e]">
          {canManage
            ? "Edit the AI narration if you want, then generate the video. Each slide stays on screen until the voiceover finishes. The point being explained stays sharp; the rest of the slide is blurred."
            : "This presentation does not have a narrated video yet. Check back after your teacher generates it. You can still download the original PowerPoint."}
        </div>
      )}

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSlidePos(i)}
                  className={`h-8 min-w-8 rounded-md px-2 text-xs font-semibold ${
                    i === slidePos ? "bg-[#031635] text-white" : "bg-[#e8edf5] text-[#031635]"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            {slide ? (
              <div className="rounded-xl border border-[#e1e3e4] bg-white p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#75777f]">
                  Slide {slide.index + 1} extracted text
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[#44474e]">
                  {slide.extracted_text || "No text extracted from this slide."}
                </p>
              </div>
            ) : null}
          </div>
          <aside className="space-y-3 rounded-xl border border-[#e1e3e4] bg-white p-4">
            <h3 className="text-sm font-semibold text-[#031635]">Narration script</h3>
            <textarea
              className={`${inputClass} min-h-40`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <PrimaryButton onClick={() => saveSlide.mutate()} disabled={!slide || saveSlide.isPending}>
              {saveSlide.isPending ? "Saving…" : "Save script"}
            </PrimaryButton>
            <PrimaryButton
              onClick={() => generateVideo.mutate()}
              disabled={generateVideo.isPending || !slides.length}
            >
              {generateVideo.isPending ? "Generating video…" : "Generate video"}
            </PrimaryButton>
            <p className="text-[11px] text-[#75777f]">
              This writes an explanatory voiceover (not just the extracted bullets), keeps each slide until that audio ends, and highlights the current point. It can take several minutes. Saving a script clears the previous video.
            </p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
