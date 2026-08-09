import DragOverlay from "../components/DragOverlay";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contentsApi } from "../api";
import { useAuth } from "../auth/AuthContext";
import type { Content } from "../api/types";
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  File,
  Search,
  Pencil,
  Trash2,
} from "lucide-react";

function getFileUrl(filePath: string) {
  if (!filePath) return "#";
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
    return filePath;
  }
  const cleanPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const backendBase = (
    import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
  ).replace(/\/api\/v1\/?$/, "");
  return `${backendBase}${cleanPath}`;
}

function getFileType(filePath: string) {
  const extension = filePath.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "pdf":
      return {
        label: "PDF",
        icon: FileText,
        colorClass: "text-red-500",
        badgeClass: "bg-red-500",
        tileClass: "bg-red-500/10 border-red-500/20",
      };

    case "doc":
    case "docx":
      return {
        label: "DOC",
        icon: FileText,
        colorClass: "text-blue-500",
        badgeClass: "bg-blue-500",
        tileClass: "bg-blue-500/10 border-blue-500/20",
      };

    case "xls":
    case "xlsx":
      return {
        label: "XLS",
        icon: FileSpreadsheet,
        colorClass: "text-green-500",
        badgeClass: "bg-green-500",
        tileClass: "bg-green-500/10 border-green-500/20",
      };

    case "ppt":
    case "pptx":
      return {
        label: "PPT",
        icon: Presentation,
        colorClass: "text-orange-500",
        badgeClass: "bg-orange-500",
        tileClass: "bg-orange-500/10 border-orange-500/20",
      };

    default:
      return {
        label: extension?.toUpperCase() || "FILE",
        icon: File,
        colorClass: "text-mist",
        badgeClass: "bg-panel-low",
        tileClass: "bg-panel-low/60 border-line",
      };
  }
}
export function ClassroomDocumentsTab() {
  const { classroomId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingDoc, setEditingDoc] = useState<Content | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<Content | null>(null);

  const [editTitle, setEditTitle] = useState("");

  const [editDescription, setEditDescription] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [isDragging, setIsDragging] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["documents", classroomId],
    queryFn: () => contentsApi.listByClassroom(Number(classroomId)),
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => {
      return contentsApi.upload(Number(classroomId), formData);
    },

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documents", classroomId],
      });
    },

    onError: (err) => {
      console.error("Upload failed", err);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (contentId: number) =>
      contentsApi.delete(Number(classroomId), contentId),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documents", classroomId],
      });
    },

    onError: (err) => {
      console.error("Delete failed", err);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      contentsApi.update(editingDoc!.id, {
        title: editTitle,
        description: editDescription,
      }),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documents", classroomId],
      });

      setEditingDoc(null);
    },

    onError: (err) => {
      console.error("Update failed", err);
    },
  });

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();

      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();

      if (e.clientX === 0 && e.clientY === 0) {
        setIsDragging(false);
      }
    };

    const handleDrop = () => {
      setIsDragging(false);
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  if (isLoading) {
    return <p>Loading documents...</p>;
  }

  if (isError) {
    return <p>Failed to load documents.</p>;
  }

  const uploadFile = (file: File) => {
    if (!user) return;

    const formData = new FormData();

    formData.append("title", file.name);
    formData.append("description", "");
    formData.append("content_type", "PDF");
    formData.append("uploaded_by", String(user.id));
    formData.append("file", file);

    uploadMutation.mutate(formData);
  };

  return (
    <>
      <DragOverlay onDropFile={uploadFile} />

      <div
        className={`space-y-4 transition-colors ${isDragging ? "ring-2 ring-cyan-400" : ""}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-paper">Documents</h2>

            <p className="mt-1 text-sm text-mist">
              {data?.length ?? 0}{" "}
              {data?.length === 1 ? "resource" : "resources"} available
            </p>
          </div>

          {user?.role === "CLASS_TEACHER" && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Upload Document
            </button>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#75777f]" />

            <input
              type="text"
              placeholder="Search documents…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-[#c5c6cf] bg-[#f8f9fa] py-2.5 pl-10 pr-3.5 text-sm text-[#191c1d] outline-none transition placeholder:text-[#75777f] focus:border-[#031635] focus:bg-white focus:ring-1 focus:ring-[#031635]"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm font-medium text-mist sm:inline">
              Sort:
            </span>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-xl border border-[#c5c6cf] bg-[#f8f9fa] px-3.5 py-2.5 text-sm font-medium text-[#191c1d] outline-none transition hover:bg-white focus:border-[#031635] focus:bg-white focus:ring-1 focus:ring-[#031635]"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="az">A - Z</option>
              <option value="za">Z - A</option>
            </select>
          </div>
        </div>

        {/*
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);

          const file = e.dataTransfer.files?.[0];

          if (!file) return;

          uploadFile(file);
        }}
        className={`mt-4 cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
          isDragging
            ? "border-blue-500 bg-blue-500/10"
            : "border-line hover:border-blue-400 hover:bg-slate-800/30"
        }`}
      >
        <div className="space-y-2">
          <div className="text-4xl">📁</div>

          <h3 className="text-lg font-semibold">Drag & Drop Documents Here</h3>

          <p className="text-sm opacity-70">
            or click the Upload Document button above
          </p>

          <p className="text-xs opacity-50">PDF • DOCX • PPT • Images</p>
        </div>
      </div>
      */}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];

            if (!file) return;

            uploadFile(file);

            e.target.value = "";
          }}
        />

        {data?.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel-low/30 px-6 py-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <FileText className="h-7 w-7" />
            </div>

            <h3 className="text-base font-semibold text-paper">
              No documents yet
            </h3>

            <p className="mt-1 max-w-sm text-sm leading-5 text-mist">
              {user?.role === "CLASS_TEACHER"
                ? "Upload your first classroom document to make course resources available to students."
                : "Your teacher hasn't uploaded any classroom documents yet."}
            </p>

            {user?.role === "CLASS_TEACHER" && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Upload Document
              </button>
            )}
          </div>
        )}

        {data
          ?.filter((doc) => {
            const search = searchTerm.toLowerCase();

            return (
              doc.title.toLowerCase().includes(search) ||
              doc.file_name.toLowerCase().includes(search) ||
              (doc.description ?? "").toLowerCase().includes(search)
            );
          })
          .sort((a, b) => {
            switch (sortBy) {
              case "oldest":
                return (
                  new Date(a.created_at).getTime() -
                  new Date(b.created_at).getTime()
                );

              case "az":
                return a.title.localeCompare(b.title);

              case "za":
                return b.title.localeCompare(a.title);

              case "newest":
              default:
                return (
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime()
                );
            }
          })
          .map((doc) => {
            const fileType = getFileType(doc.file_path);

            return (
              <div
                key={doc.id}
                className="group rounded-xl border border-line bg-panel-low/40 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-panel-low/60 hover:shadow-md"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border transition-transform duration-200 group-hover:scale-105 ${fileType.tileClass} ${fileType.colorClass}`}
                    >
                      <fileType.icon className="h-7 w-7" strokeWidth={1.8} />

                      <span
                        className={`absolute bottom-1 rounded px-1.5 py-0.5 text-[8px] font-bold leading-none tracking-wide text-white ${fileType.badgeClass}`}
                      >
                        {fileType.label}
                      </span>
                    </div>

                    <a
                      href={getFileUrl(doc.file_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0"
                    >
                      <h3 className="truncate text-base font-semibold text-paper transition-colors group-hover:text-accent">
                        {doc.title}
                      </h3>

                      <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-mist">
                        {fileType.label} document
                      </p>
                    </a>
                  </div>

                  <div className="flex items-center gap-2">
                    {user?.role === "CLASS_TEACHER" && (
                      <button
                        onClick={() => {
                          setEditingDoc(doc);
                          setEditTitle(doc.title);
                          setEditDescription(doc.description ?? "");
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-lg text-sky-400 transition-all duration-200 hover:border-sky-500 hover:bg-sky-500/10 hover:scale-105"
                        title="Edit document"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}

                    {user?.role === "CLASS_TEACHER" && (
                      <button
                        onClick={() => setDeletingDoc(doc)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-lg text-red-500 transition-all duration-200 hover:border-red-500 hover:bg-red-500/10 hover:scale-105"
                        title="Delete document"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {doc.description ? (
                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-mist">
                    {doc.description}
                  </p>
                ) : (
                  <p className="mt-2 text-sm italic text-mist/60">
                    No description provided
                  </p>
                )}

                <a
                  href={getFileUrl(doc.file_path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-panel-low/50 px-3 py-2.5 transition-all duration-200 hover:border-accent/40 hover:bg-accent/5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <fileType.icon className="h-4 w-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-paper">
                      {doc.file_name}
                    </span>

                    <span className="mt-0.5 block text-xs text-mist">
                      Open document
                    </span>
                  </span>

                  <span className="rounded-md border border-line bg-panel-low px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-mist">
                    {fileType.label}
                  </span>
                </a>

                <p className="mt-2 text-xs text-mist">
                  Added{" "}
                  {new Date(doc.created_at).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            );
          })}

        {/* Edit Modal */}
        {editingDoc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="w-full max-w-lg rounded-xl border border-line bg-slate-900 p-6 shadow-xl">
              <h2 className="mb-6 text-xl font-semibold">Edit Document</h2>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Title
                  </label>

                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-line bg-slate-800 px-3 py-2"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Description
                  </label>

                  <textarea
                    rows={4}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full rounded-lg border border-line bg-slate-800 px-3 py-2"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setEditingDoc(null)}
                  className="rounded-lg border border-line px-4 py-2"
                >
                  Cancel
                </button>

                <button
                  onClick={() => updateMutation.mutate()}
                  className="rounded-lg bg-accent px-4 py-2 text-white hover:opacity-90"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {deletingDoc &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
            onClick={() => setDeletingDoc(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                <Trash2 className="h-6 w-6" />
              </div>

              <h2 className="mt-5 text-xl font-semibold text-paper">
                Delete document?
              </h2>

              <p className="mt-2 text-sm leading-6 text-mist">
                Are you sure you want to delete{" "}
                <span className="font-medium text-paper">
                  "{deletingDoc.title}"
                </span>
                ?
              </p>

              <p className="mt-2 text-xs text-mist/70">
                This action cannot be undone.
              </p>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeletingDoc(null)}
                  className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-paper transition hover:bg-panel-low"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => {
                    deleteMutation.mutate(deletingDoc.id);
                    setDeletingDoc(null);
                  }}
                  className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
                >
                  Delete document
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
