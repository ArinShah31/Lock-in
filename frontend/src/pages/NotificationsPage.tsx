import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useStudentNotifications } from "../hooks/useStudentNotifications";
import { useTeacherNotifications } from "../hooks/useTeacherNotifications";
import { EmptyState, PageHeader, Panel } from "../components/ui";

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isTeacher = user?.role !== "STUDENT";
  const teacher = useTeacherNotifications();
  const student = useStudentNotifications();
  const feed = isTeacher ? teacher : student;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Recent updates from your classrooms and assignments. Notification preferences are not configurable yet."
      />

      {feed.loading ? <p className="text-sm text-[#44474e]">Loading notifications...</p> : null}

      {!feed.loading && !feed.items.length ? (
        <EmptyState title="No notifications" body="You're all caught up. New announcements, assignments, and activity will appear here." />
      ) : null}

      <div className="space-y-3">
        {feed.items.map((item) => (
          <Panel key={item.id}>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => {
                if (item.to) navigate(item.to);
              }}
            >
              <p className="font-semibold text-[#031635]">{item.title}</p>
              <p className="mt-1 text-sm text-[#44474e]">{item.subtitle}</p>
            </button>
          </Panel>
        ))}
      </div>
    </div>
  );
}
