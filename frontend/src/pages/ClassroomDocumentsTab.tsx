import { useRef } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contentsApi } from "../api";
import { API_BASE } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type Content = {
  id: number;
  title: string;
  description: string | null;
  content_type: string;
  file_name: string;
  file_path: string;
  created_at: string;
};

export function ClassroomDocumentsTab() {
  

  const { classroomId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  if (isLoading) {
    return <p>Loading documents...</p>;
  }

  if (isError) {
    return <p>Failed to load documents.</p>;
  }

  return (
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

     <input
     ref={fileInputRef}
     type="file"
     className="hidden"
     onChange={(e) => {
        
        
        
        
        
        const file = e.target.files?.[0];
        
        
        if (!file) {
          
          return;
        }
        
        
        
        if (!user) {
          
            
          return;
        }
        
        
        
        const formData = new FormData();
        formData.append("title", file.name);
        formData.append("description", "");
        formData.append("content_type", "PDF");
        formData.append("uploaded_by", String(user.id));
        formData.append("file", file);
        
        
        
        uploadMutation.mutate(formData);
        
        
        
        e.target.value = "";
     }}
     />

      {data?.length === 0 && (
        <p>No documents uploaded yet.</p>
      )}

      {data?.map((doc) => (
        <div
          key={doc.id}
          className="rounded-lg border border-line p-4"
        >
          <h3 className="font-semibold">{doc.title}</h3>

          <p className="text-sm opacity-70">
            {doc.description}
          </p>

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
    </div>
  );
}