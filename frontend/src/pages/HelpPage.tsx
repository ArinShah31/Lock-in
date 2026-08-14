import { PageHeader, Panel } from "../components/ui";

const helpItems = [
  {
    title: "Join a classroom",
    body: "Use your teacher's join code from Classrooms, then wait for approval if required.",
  },
  {
    title: "Complete practice",
    body: "Open Practice from the sidebar to take quizzes, scenarios, flashcards, and assessments.",
  },
  {
    title: "Submit assignments",
    body: "Go to your classroom's Assignments tab to upload work before the due date.",
  },
  {
    title: "Course materials",
    body: "Teachers publish course content in Course Builder. Students access lessons from the classroom dashboard.",
  },
  {
    title: "Ask ASTRA",
    body: "Students can use the course bot inside classrooms. Teachers can open Ask ASTRA from the dashboard.",
  },
];

export function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Help & Support"
        subtitle="Quick guidance for using ASTRA LMS. For account issues, contact your institution administrator."
      />
      <div className="space-y-3">
        {helpItems.map((item) => (
          <Panel key={item.title}>
            <h2 className="font-semibold text-[#031635]">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#44474e]">{item.body}</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
