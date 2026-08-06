import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const proseClass =
  "course-markdown academic-text text-[15px] leading-relaxed text-paper/90 " +
  "[&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:font-display [&_h1]:text-xl [&_h1]:text-paper " +
  "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-lg [&_h2]:text-paper " +
  "[&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-paper " +
  "[&_h4]:mb-1.5 [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-paper " +
  "[&_p]:mb-3 [&_p]:last:mb-0 " +
  "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 " +
  "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 " +
  "[&_li]:text-mist " +
  "[&_strong]:font-semibold [&_strong]:text-paper " +
  "[&_em]:italic " +
  "[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline " +
  "[&_code]:rounded [&_code]:bg-panel-low [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-sans [&_code]:text-[0.9em] " +
  "[&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-line [&_pre]:bg-panel-low [&_pre]:p-3 [&_pre]:font-sans [&_pre]:text-sm " +
  "[&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-3 [&_blockquote]:text-mist " +
  "[&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto";

export function CourseMarkdown({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const trimmed = content?.trim();
  if (!trimmed) return null;

  return (
    <div className={`${proseClass} ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
