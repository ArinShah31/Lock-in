type Props = {
  markdown: string;
};

/** Lightweight markdown renderer for lesson notes (no extra dependency). */
export function MarkdownNotes({ markdown }: Props) {
  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/);

  return (
    <div className="space-y-3 text-sm leading-relaxed text-mist">
      {blocks.map((block, index) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={index} className="pt-1 font-display text-base text-paper">
              {inlineFormat(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={index} className="pt-2 font-display text-lg text-paper">
              {inlineFormat(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <h2 key={index} className="pt-2 font-display text-xl text-paper">
              {inlineFormat(trimmed.slice(2))}
            </h2>
          );
        }

        const lines = trimmed.split("\n");
        const isList = lines.every((line) => /^(- |\* |\d+\. )/.test(line.trim()) || !line.trim());
        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lines
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, lineIndex) => (
                  <li key={lineIndex}>{inlineFormat(line.replace(/^(- |\* |\d+\. )/, ""))}</li>
                ))}
            </ul>
          );
        }

        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inlineFormat(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inlineFormat(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-paper">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
