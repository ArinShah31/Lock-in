import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contentsApi } from "../api";
import { API_BASE } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function ClassroomDocumentsTab() {
  const { classroomId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingDoc, setEditingDoc] = useState<Content | null>(null);

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
      {isDragging && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);

            const file = e.dataTransfer.files?.[0];

            if (!file) return;

            uploadFile(file);
          }}
        >
          <div className="rounded-2xl border-2 border-dashed border-blue-500 bg-slate-900/90 px-20 py-16 text-center shadow-2xl">
            <div className="mb-4 text-7xl">📁</div>

            <h2 className="text-3xl font-bold text-white">
              Drop files to upload
            </h2>

            <p className="mt-3 text-slate-300">
              Release your document anywhere to upload
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Documents</h2>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Upload Document
          </button>
        </div>

        <div className="mt-4 flex gap-4">
          <input
            type="text"
            placeholder="🔍 Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 rounded-lg border border-line bg-slate-800 px-4 py-2 outline-none focus:border-accent"
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-line bg-slate-800 px-4 py-2 outline-none focus:border-accent"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="az">A - Z</option>
            <option value="za">Z - A</option>
          </select>
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

        {data?.length === 0 && <p>No documents uploaded yet.</p>}

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
          .map((doc) => (
            <div key={doc.id} className="rounded-lg border border-line p-4">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{doc.title}</h3>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingDoc(doc);
                      setEditTitle(doc.title);
                      setEditDescription(doc.description ?? "");
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-lg text-sky-400 transition-all duration-200 hover:border-sky-500 hover:bg-sky-500/10 hover:scale-105"
                    title="Edit document"
                  >
                    ✏️
                  </button>

                  <button
                    onClick={() => {
                      const confirmed = window.confirm(
                        "Are you sure you want to delete this document?",
                      );

                      if (!confirmed) return;

                      deleteMutation.mutate(doc.id);
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-lg text-red-500 transition-all duration-200 hover:border-red-500 hover:bg-red-500/10 hover:scale-105"
                    title="Delete document"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <p className="text-sm opacity-70">{doc.description}</p>

              <a
                href={`${API_BASE.replace("/api/v1", "")}/${doc.file_path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-accent hover:underline"
              >
                📄 {doc.file_name}
              </a>

              <p className="text-xs opacity-60">
                {new Date(doc.created_at).toLocaleString()}
              </p>
            </div>
          ))}

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
    </>
  );
}
