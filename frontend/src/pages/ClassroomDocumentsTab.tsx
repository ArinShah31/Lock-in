import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { contentsApi } from "../api";

export function ClassroomDocumentsTab() {
  const { classroomId } = useParams();

  const { data, isLoading, isError } = useQuery({
  queryKey: ["documents", classroomId],
  queryFn: () => contentsApi.listByClassroom(Number(classroomId)),
});

  if (isLoading) {
    return <p>Loading documents...</p>;
  }

  if (isError) {
    return <p>Failed to load documents.</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Documents</h2>

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
          href={`http://127.0.0.1:8000/${doc.file_path}`}
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