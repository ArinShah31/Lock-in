import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PolarAngleAxis, RadialBar, RadialBarChart, Tooltip } from "recharts";
import { Panel, PrimaryButton, SecondaryButton } from "./ui";
import type { StudentTodoItem, WorkProgressSegment } from "../hooks/useStudentWorkProgress";

const CHART_SIZE = 230;
/** Matches streaks tab height (badges + chart + legend + todo) so tab switches do not resize the dashboard. */
const TAB_PANEL_MIN_HEIGHT = 560;

const tabPanelShellClass = "flex flex-col";
const tabPanelShellStyle = { minHeight: TAB_PANEL_MIN_HEIGHT };

type CardTab = "streaks" | "timeline";

type NextCoding = {
  status: "ASSIGNED" | "IN_PROGRESS";
  test_title?: string | null;
};

type RadialChartDatum = {
  key: string;
  label: string;
  description: string;
  value: number;
  completed: number;
  total: number;
  fill: string;
};

const TODO_BADGE_CLASS: Record<StudentTodoItem["type"], string> = {
  assignment: "bg-[#ffdad6] text-[#ba1a1a]",
  coding: "bg-[#e8edf5] text-[#3f5d9b]",
  quiz: "bg-[#f5efe4] text-[#9a6b2f]",
  scenario: "bg-[#f5efe4] text-[#9a6b2f]",
  assessment: "bg-[#edf3ff] text-[#3f5d9b]",
  exam: "bg-[#e7f3ec] text-[#2f6b4f]",
};

function segmentPct(segment: Pick<WorkProgressSegment, "completed" | "total">) {
  if (segment.total <= 0) return 0;
  return Math.round((segment.completed / segment.total) * 100);
}

function SegmentTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: RadialChartDatum }>;
}) {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;

  return (
    <div className="z-50 max-w-[220px] rounded-lg border border-[#e1e3e4] bg-white px-3 py-2.5 shadow-md">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: data.fill }} />
        <p className="text-xs font-bold text-[#031635]">{data.label}</p>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[#44474e]">{data.description}</p>
      <p className="mt-2 text-xs font-semibold text-[#3f5d9b]">
        {data.completed} / {data.total} completed
      </p>
      <p className="mt-0.5 text-[10px] text-[#75777f]">{data.value}% of this category done</p>
    </div>
  );
}

function ChartLegend({ segments }: { segments: WorkProgressSegment[] }) {
  if (!segments.length) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {segments.map((segment) => (
        <span key={segment.key} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#44474e]">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.fill }} />
          {segment.label}
          <span className="text-[#75777f]">({segmentPct(segment)}%)</span>
        </span>
      ))}
    </div>
  );
}

function CompletionRadialChart({
  percent,
  completed,
  total,
  segments,
}: {
  percent: number;
  completed: number;
  total: number;
  segments: WorkProgressSegment[];
}) {
  const safe = Math.max(0, Math.min(100, percent));

  const chartData = useMemo((): RadialChartDatum[] => {
    if (segments.length === 0) {
      return [
        {
          key: "overall",
          label: "Overall",
          description: "All assigned work combined across tasks, coding, and practice",
          value: safe,
          completed,
          total,
          fill: "#3f5d9b",
        },
      ];
    }

    return segments.map((segment) => ({
      key: segment.key,
      label: segment.label,
      description: segment.description,
      value: segmentPct(segment),
      completed: segment.completed,
      total: segment.total,
      fill: segment.fill,
    }));
  }, [safe, completed, total, segments]);

  return (
    <div className="flex w-full flex-col items-center">
      <div className="relative mx-auto" style={{ width: CHART_SIZE, height: CHART_SIZE }}>
        <RadialBarChart
          width={CHART_SIZE}
          height={CHART_SIZE}
          cx={CHART_SIZE / 2}
          cy={CHART_SIZE / 2}
          data={chartData}
          startAngle={90}
          endAngle={-270}
          innerRadius={64}
          outerRadius={104}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} allowDataOverflow />
          <Tooltip content={<SegmentTooltip />} cursor={false} wrapperStyle={{ zIndex: 50 }} />
          <RadialBar background={{ fill: "#e8edf5" }} cornerRadius={10} dataKey="value" />
        </RadialBarChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-[20px] text-[#9a6b2f]">emoji_events</span>
          <p className="font-display text-3xl font-extrabold leading-none text-[#031635] xl:text-4xl">{safe}%</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#75777f]">Complete</p>
        </div>
      </div>
      <ChartLegend segments={segments} />
    </div>
  );
}

function TodoList({ items }: { items: StudentTodoItem[] }) {
  if (!items.length) {
    return (
      <div className="pt-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#75777f]">To do</p>
        <p className="mt-2 text-sm font-semibold text-[#031635]">All caught up</p>
        <p className="mt-1 text-xs text-[#44474e]">No pending assignments or assessments.</p>
      </div>
    );
  }

  return (
    <div className="w-full pt-1">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#75777f]">To do</p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.href}
              className="group flex items-center justify-between gap-3 rounded-lg border border-transparent px-1 py-1.5 transition hover:border-[#e1e3e4] hover:bg-[#f8f9fa]"
            >
              <span className="min-w-0 truncate text-sm font-semibold text-[#031635] group-hover:text-[#3f5d9b]">
                {item.title}
              </span>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${TODO_BADGE_CLASS[item.type]}`}
              >
                {item.badge}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimelineItem({
  title,
  body,
  badge,
  tone = "neutral",
}: {
  title: string;
  body: string;
  badge: string;
  tone?: "neutral" | "blue" | "red" | "green";
}) {
  const badgeClass = {
    neutral: "bg-[#f8f9fa] border border-[#e1e3e4] text-[#44474e]",
    blue: "bg-[#e8edf5] text-[#3f5d9b]",
    red: "bg-[#ffdad6] text-[#ba1a1a]",
    green: "bg-[#e7f3ec] text-[#2f6b4f]",
  }[tone];

  return (
    <div className="timeline-node pl-8">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-[#031635]">{title}</p>
        <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${badgeClass}`}>
          {badge}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-[#44474e]">{body}</p>
    </div>
  );
}

function StreakBadge({ streak, isLoading }: { streak: number; isLoading: boolean }) {
  if (isLoading) {
    return (
      <span className="inline-flex h-8 w-36 animate-pulse rounded-full bg-[#f5efe4]" aria-hidden="true" />
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-[#f5efe4] px-2.5 py-1 text-sm font-extrabold text-[#9a6b2f]"
      title="Consecutive submissions before deadline. Late or missed work resets your streak."
    >
      <span className="material-symbols-outlined text-[16px]">local_fire_department</span>
      {streak} on-time streak
    </span>
  );
}

function CardTabBar({ activeTab, onChange }: { activeTab: CardTab; onChange: (tab: CardTab) => void }) {
  const tabs: { id: CardTab; label: string; icon: string }[] = [
    { id: "streaks", label: "Streaks", icon: "local_fire_department" },
    { id: "timeline", label: "Timeline", icon: "timeline" },
  ];

  return (
    <div className="mb-3.5 flex gap-1 border-b border-[#e1e3e4]">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              "font-display flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 pb-2.5 text-sm font-semibold transition",
              isActive
                ? "border-[#3f5d9b] text-[#031635]"
                : "border-transparent text-[#75777f] hover:text-[#031635]",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function StreaksTabContent({
  completionPct,
  completed,
  total,
  segments,
  todoItems,
  isLoading,
  isError,
  streak,
  streakLoading,
}: {
  completionPct: number;
  completed: number;
  total: number;
  segments: WorkProgressSegment[];
  todoItems: StudentTodoItem[];
  isLoading: boolean;
  isError: boolean;
  streak: number;
  streakLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className={`${tabPanelShellClass} space-y-3`} style={tabPanelShellStyle}>
        <StreakBadge streak={0} isLoading={streakLoading || isLoading} />
        <div
          className="mx-auto animate-pulse rounded-full bg-[#e8edf5]"
          style={{ width: CHART_SIZE, height: CHART_SIZE }}
        />
        <div className="space-y-2 border-t border-[#e1e3e4] pt-3">
          <div className="h-3 w-12 animate-pulse rounded bg-[#e8edf5]" />
          <div className="h-8 animate-pulse rounded bg-[#f8f9fa]" />
          <div className="h-8 animate-pulse rounded bg-[#f8f9fa]" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`${tabPanelShellClass} items-start`} style={tabPanelShellStyle}>
        <p className="text-xs text-red-600">Could not load progress. Refresh to try again.</p>
      </div>
    );
  }

  return (
    <div className={`${tabPanelShellClass} space-y-3`} style={tabPanelShellStyle}>
      <StreakBadge streak={streak} isLoading={streakLoading} />
      <CompletionRadialChart
        percent={completionPct}
        completed={completed}
        total={total}
        segments={segments}
      />
      <div className="border-t border-[#e1e3e4] pt-4">
        <TodoList items={todoItems} />
      </div>
    </div>
  );
}

function TimelineTabContent({
  nextCoding,
  codingEnabled,
  enrolledCount,
}: {
  nextCoding?: NextCoding | null;
  codingEnabled: boolean;
  enrolledCount: number;
}) {
  const navigate = useNavigate();

  return (
    <div className={tabPanelShellClass} style={tabPanelShellStyle}>
      <div className="space-y-4">
        {nextCoding ? (
          <TimelineItem
            title={`${nextCoding.status === "IN_PROGRESS" ? "Resume" : "Start"} coding test`}
            body={nextCoding.test_title || "A coding assessment is waiting in your workspace."}
            badge={nextCoding.status === "IN_PROGRESS" ? "Resume" : "Due"}
            tone={nextCoding.status === "IN_PROGRESS" ? "blue" : "red"}
          />
        ) : (
          <TimelineItem
            title="Coding clear"
            body={
              codingEnabled
                ? "No open coding tests right now."
                : "Coding unlock depends on enabled teachers in your classroom."
            }
            badge="Clear"
            tone="green"
          />
        )}
        <TimelineItem
          title="Classroom sync"
          body={`${enrolledCount} active classroom${enrolledCount === 1 ? "" : "s"} connected to your dashboard.`}
          badge="Today"
          tone="blue"
        />
        <TimelineItem
          title="Assignment check"
          body="Review classroom assignments and published materials before the next session."
          badge="Upcoming"
        />
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <SecondaryButton onClick={() => navigate("/classrooms")}>Classrooms</SecondaryButton>
        <PrimaryButton onClick={() => navigate("/coding")}>Coding</PrimaryButton>
      </div>
    </div>
  );
}

export function StudentStreaksCard({
  completionPct,
  completed,
  total,
  segments,
  todoItems,
  isLoading,
  isError,
  streak,
  streakLoading,
  nextCoding,
  codingEnabled,
  enrolledCount,
}: {
  completionPct: number;
  completed: number;
  total: number;
  segments: WorkProgressSegment[];
  todoItems: StudentTodoItem[];
  isLoading: boolean;
  isError: boolean;
  streak: number;
  streakLoading: boolean;
  nextCoding?: NextCoding | null;
  codingEnabled: boolean;
  enrolledCount: number;
}) {
  const [activeTab, setActiveTab] = useState<CardTab>("streaks");

  return (
    <Panel className="flex h-full flex-col animate-rise-delay !p-4 xl:!p-5">
      <CardTabBar activeTab={activeTab} onChange={setActiveTab} />

      <div className="flex-1">
        {activeTab === "streaks" ? (
          <StreaksTabContent
            completionPct={completionPct}
            completed={completed}
            total={total}
            segments={segments}
            todoItems={todoItems}
            isLoading={isLoading}
            isError={isError}
            streak={streak}
            streakLoading={streakLoading}
          />
        ) : (
          <TimelineTabContent
            nextCoding={nextCoding}
            codingEnabled={codingEnabled}
            enrolledCount={enrolledCount}
          />
        )}
      </div>
    </Panel>
  );
}
