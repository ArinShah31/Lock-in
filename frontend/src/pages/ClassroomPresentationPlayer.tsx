import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { presentationsApi } from "../api";
import type { Classroom, PresentationCue, PresentationSlide } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorText, GhostButton, JobProgress, PrimaryButton, inputClass } from "../components/ui";

type OutletCtx = { classroom: Classroom };
const TEACHER_ROLES = new Set(["CLASS_TEACHER", "SUBJECT_TEACHER", "SUPER_ADMIN"]);

function slideImageSrc(
  classroomId: number,
  presentationId: number,
  slide: PresentationSlide | null,
) {
  if (!slide?.has_image) return null;
  return presentationsApi.mediaSrc(presentationsApi.imageUrl(classroomId, presentationId, slide.id));
}

function SlidePreview({
  classroomId,
  presentationId,
  slide,
  className = "",
}: {
  classroomId: number;
  presentationId: number;
  slide: PresentationSlide;
  className?: string;
}) {
  const src = slideImageSrc(classroomId, presentationId, slide);
  if (src) {
    return (
      <img
        src={src}
        alt={`Slide ${slide.index + 1}`}
        loading="lazy"
        className={`h-full w-full object-contain bg-white ${className}`}
      />
    );
  }
  return (
    <div className={`flex h-full w-full items-center bg-[#f4f6f8] p-3 ${className}`}>
      <p className="line-clamp-6 text-left text-[11px] leading-4 text-[#44474e]">
        {slide.extracted_text || `Slide ${slide.index + 1}`}
      </p>
    </div>
  );
}

function fullscreenElement() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function exitFullscreen() {
  const doc = document as Document & { webkitExitFullscreen?: () => void };
  if (document.fullscreenElement && document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  doc.webkitExitFullscreen?.();
}

async function enterFullscreen(el: HTMLElement) {
  const node = el as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  node.webkitRequestFullscreen?.();
}

function formatClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function NarratedVideo({ src, cues }: { src: string; cues: PresentationCue[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ccOn, setCcOn] = useState(true);
  const [caption, setCaption] = useState("");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFs, setIsFs] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [captionSize, setCaptionSize] = useState<"s" | "m" | "l" | "xl">("m");

  function captionAt(timeSec: number) {
    const t = timeSec * 1000;
    const hit = cues.find((cue) => t >= cue.start_ms && t < cue.end_ms);
    return (hit?.text ?? "").replace(/\s+/g, " ").trim();
  }

  function syncFromVideo() {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = video.currentTime || 0;
    setCurrent(nextTime);
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setPlaying(!video.paused);
    setMuted(video.muted);
    setVolume(video.volume);
    const next = captionAt(nextTime);
    setCaption((prev) => (prev === next ? prev : next));
  }

  async function toggleFullscreen() {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (fullscreenElement() === wrap) {
      await exitFullscreen();
      return;
    }
    await enterFullscreen(wrap);
    wrap.focus();
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  useEffect(() => {
    const onFs = () => setIsFs(fullscreenElement() === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  useEffect(() => {
    setCaption("");
    setCurrent(0);
    setPlaying(false);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
  }, [speed, src]);

  return (
    <div
      ref={wrapRef}
      className="narrated-wrap relative overflow-hidden rounded-xl bg-black outline-none"
      tabIndex={0}
      data-caption-size={captionSize}
      onMouseDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "SELECT") return;
        wrapRef.current?.focus();
      }}
      onKeyDown={(e) => {
        if (e.key !== " " && e.code !== "Space") return;
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "SELECT") return;
        e.preventDefault();
        togglePlay();
      }}
    >
      <video
        ref={videoRef}
        className="narrated-player"
        src={src}
        playsInline
        preload="metadata"
        controlsList="nofullscreen nodownload noremoteplayback"
        disablePictureInPicture
        onClick={togglePlay}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={syncFromVideo}
        onSeeked={syncFromVideo}
        onLoadedMetadata={() => {
          const video = videoRef.current;
          if (video) video.playbackRate = speed;
          syncFromVideo();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {ccOn && caption ? (
        <div className="narrated-caption-slot pointer-events-none absolute inset-x-0 z-20 flex justify-center px-5">
          <p className="narrated-caption line-clamp-2 text-center">{caption}</p>
        </div>
      ) : null}
      <div className="narrated-controls absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 px-3 py-2">
        <button type="button" className="narrated-ctrl-btn" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M8 5.5v13l11-6.5L8 5.5z" /></svg>
          )}
        </button>
        <span className="min-w-[4.5rem] font-mono text-[11px] tabular-nums text-white/90">
          {formatClock(current)} / {formatClock(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(current, duration || 0)}
          className="narrated-seek min-w-0 flex-1"
          aria-label="Seek"
          style={{ "--seek-fill": `${duration ? (current / duration) * 100 : 0}%` } as CSSProperties}
          onChange={(e) => {
            const video = videoRef.current;
            if (!video) return;
            video.currentTime = Number(e.target.value);
            syncFromVideo();
          }}
        />
        <button
          type="button"
          className="narrated-ctrl-btn"
          aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = !video.muted;
            setMuted(video.muted);
          }}
        >
          {muted || volume === 0 ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M5 10v4h3l4 3V7L8 10H5zm11.5 2 2.2-2.2 1.1 1.1L17.6 13l2.2 2.2-1.1 1.1L16.5 14.1l-2.2 2.2-1.1-1.1L15.4 13l-2.2-2.2 1.1-1.1 2.2 2.3z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M5 10v4h3l4 3V7L8 10H5zm8.5 2c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zm2.5 0c0 2.7-1.5 5-3.7 6.2l.8 1.5C16.1 18 18 15.2 18 12s-1.9-6-4.9-7.7l-.8 1.5C14.5 7 16 9.3 16 12z" /></svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          className="narrated-seek w-16"
          aria-label="Volume"
          style={{ "--seek-fill": `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
          onChange={(e) => {
            const video = videoRef.current;
            if (!video) return;
            const next = Number(e.target.value);
            video.volume = next;
            video.muted = next === 0;
            setVolume(next);
            setMuted(next === 0);
          }}
        />
        <select
          className="narrated-ctrl-select"
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          <option value={0.75}>0.75×</option>
          <option value={1}>1×</option>
          <option value={1.25}>1.25×</option>
          <option value={1.5}>1.5×</option>
          <option value={2}>2×</option>
        </select>
        <select
          className="narrated-ctrl-select"
          aria-label="Caption size"
          value={captionSize}
          onChange={(e) => setCaptionSize(e.target.value as "s" | "m" | "l" | "xl")}
        >
          <option value="s">Small</option>
          <option value="m">Medium</option>
          <option value="l">Large</option>
          <option value="xl">Extra large</option>
        </select>
        <button
          type="button"
          className={`narrated-ctrl-btn ${ccOn ? "narrated-ctrl-btn-on" : ""}`}
          aria-pressed={ccOn}
          aria-label={ccOn ? "Hide captions" : "Show captions"}
          onClick={() => setCcOn((on) => !on)}
        >
          CC
        </button>
        <button
          type="button"
          className="narrated-ctrl-btn"
          aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={() => void toggleFullscreen()}
        >
          {isFs ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M7 14H5v5h5v-2H7v-3zm12 0h-2v3h-3v2h5v-5zM7 7h3V5H5v5h2V7zm12-2h-5v2h3v3h2V5z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M5 5h6v2H7v4H5V5zm8 0h6v6h-2V7h-4V5zM5 13h2v4h4v2H5v-6zm12 0h2v6h-6v-2h4v-4z" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function ClassroomPresentationPlayer() {
  const { classroom } = useOutletContext<OutletCtx>();
  const { classroomId, presentationId } = useParams();
  const cid = Number(classroomId);
  const pid = Number(presentationId);
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user && TEACHER_ROLES.has(user.role);
  const thumbRef = useRef<HTMLButtonElement | null>(null);

  const [slidePos, setSlidePos] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["presentation", cid, pid],
    queryFn: () => presentationsApi.get(cid, pid),
    enabled: !Number.isNaN(cid) && !Number.isNaN(pid),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "GENERATING" || status === "PREPARING" || status === "UPLOADED" || status === "FAILED"
        ? 2000
        : false;
    },
  });

  const slides = detail.data?.slides ?? [];
  const slide = slides[slidePos] ?? null;
  const generating = detail.data?.status === "GENERATING";
  const preparing = detail.data?.status === "PREPARING" || detail.data?.status === "UPLOADED";
  const busy = generating || preparing;
  const hasVideo = Boolean(detail.data?.has_video) || detail.data?.status === "VIDEO_READY";
  const scriptsReady = detail.data?.status === "SCRIPTS_READY" && !hasVideo;
  const videoSrc = hasVideo && !generating
    ? presentationsApi.mediaSrc(presentationsApi.videoUrl(cid, pid))
    : null;

  useEffect(() => {
    setDraft(slide?.script ?? "");
  }, [slide?.id, slide?.script]);

  useEffect(() => {
    thumbRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [slidePos]);

  useEffect(() => {
    if (!canManage || !slides.length) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setSlidePos((p) => Math.min(slides.length - 1, p + 1));
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setSlidePos((p) => Math.max(0, p - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canManage, slides.length]);

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
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/classrooms/${cid}/presentations`} className="text-xs font-semibold text-[#3f5d9b]">
            ← Presentations
          </Link>
          <h2 className="mt-1 font-display text-xl font-extrabold text-[#031635]">{detail.data.title}</h2>
          <p className="text-xs text-[#75777f]">
            {classroom.name} · {slides.length} slide{slides.length === 1 ? "" : "s"}
            {slide ? ` · viewing ${slide.index + 1}` : ""}
          </p>
        </div>
        <GhostButton onClick={() => void presentationsApi.download(cid, pid, detail.data.file_name)}>
          Download original PPTX
        </GhostButton>
      </div>

      <ErrorText message={detail.data.error_message || error} />

      {preparing ? (
        <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3">
          <JobProgress
            message={detail.data.progress_message}
            fallback="Rendering slides and writing narration…"
          />
          <p className="mt-2 text-[11px] text-[#75777f]">This runs in the background — you can stay on this page.</p>
        </div>
      ) : null}

      {generating ? (
        <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] px-4 py-3">
          <JobProgress
            message={detail.data.progress_message}
            fallback="Generating video in the background…"
          />
          <p className="mt-2 text-[11px] text-[#75777f]">Voiceover and encoding can take a few minutes for large decks.</p>
        </div>
      ) : null}

      {scriptsReady ? (
        <div className="rounded-xl border border-[#d6e3ff] bg-[#f4f7ff] px-4 py-3 text-sm text-[#031635]">
          Slide images and spoken scripts are ready ({slides.length} slides). Click <strong>Generate video</strong> to create the narrated MP4 — that step shows voiceover progress (1/{slides.length}, 2/{slides.length}, …).
        </div>
      ) : null}

      {videoSrc && !canManage ? (
        <NarratedVideo src={videoSrc} cues={detail.data.caption_cues ?? []} />
      ) : null}

      {videoSrc && canManage ? (
        <details className="rounded-xl border border-[#e1e3e4] bg-white">
          <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-[#031635]">
            Watch narrated video
          </summary>
          <div className="px-4 pb-4">
            <NarratedVideo src={videoSrc} cues={detail.data.caption_cues ?? []} />
          </div>
        </details>
      ) : null}

      {!canManage && !videoSrc && !generating && !preparing ? (
        <div className="rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-4 text-sm text-[#44474e]">
          This presentation does not have a narrated video yet. Check back after your teacher generates it. You can still download the original PowerPoint.
        </div>
      ) : null}

      {canManage ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[11rem_minmax(0,1fr)_22rem]">
          <aside className="max-h-[calc(100vh-11rem)] overflow-y-auto rounded-xl border border-[#e1e3e4] bg-[#f8f9fa] p-2">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[#75777f]">Slides</p>
            <div className="space-y-2">
              {slides.map((item, i) => (
                <button
                  key={item.id}
                  ref={i === slidePos ? thumbRef : undefined}
                  type="button"
                  onClick={() => setSlidePos(i)}
                  className={`relative w-full overflow-hidden rounded-lg border-2 ${
                    i === slidePos ? "border-[#031635] ring-2 ring-[#031635]/20" : "border-transparent hover:border-[#c5cdd8]"
                  }`}
                >
                  <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-[#031635]/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="block aspect-video bg-white">
                    <SlidePreview classroomId={cid} presentationId={pid} slide={item} />
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-h-[18rem] flex-col overflow-hidden rounded-xl border border-[#d8dde3] bg-[#1a1d24]">
            {slide ? (
              <SlidePreview
                classroomId={cid}
                presentationId={pid}
                slide={slide}
                className="rounded-xl"
              />
            ) : (
              <p className="m-auto text-sm text-white/70">No slides</p>
            )}
          </section>

          <aside className="flex min-h-0 flex-col gap-3 rounded-xl border border-[#e1e3e4] bg-white p-4">
            <div>
              <h3 className="text-sm font-semibold text-[#031635]">
                Narration · slide {slide ? slide.index + 1 : "—"}
              </h3>
              <p className="text-[11px] text-[#75777f]">Edit the spoken script for the slide on the left.</p>
            </div>
            <textarea
              className={`${inputClass} min-h-48 flex-1`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <PrimaryButton onClick={() => saveSlide.mutate()} disabled={!slide || saveSlide.isPending || busy}>
              {saveSlide.isPending ? "Saving…" : "Save script"}
            </PrimaryButton>
            <PrimaryButton
              onClick={() => generateVideo.mutate()}
              disabled={generateVideo.isPending || busy || !slides.length}
            >
              {preparing
                ? detail.data.progress_message || "Preparing slides…"
                : generating
                ? detail.data.progress_message || "Generating…"
                : generateVideo.isPending
                  ? "Starting…"
                  : "Generate video"}
            </PrimaryButton>
            <p className="text-[11px] text-[#75777f]">
              Use the thumbnails to jump to a slide. Arrow keys also move between slides. Saving a script clears the previous video.
            </p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
