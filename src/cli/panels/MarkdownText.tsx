import React from "react";
import { Text } from "ink";

interface MarkdownTextProps {
  children: string;
}

/**
 * Lightweight inline markdown renderer.
 * Only supports: **bold**, *italic*, `code` — no block-level reformatting.
 */
export function MarkdownText({ children }: MarkdownTextProps) {
  if (!children) return <Text></Text>;

  // Split code blocks out first
  const parts = children.split(/(```[\s\S]*?```)/g);

  return (
    <React.Fragment>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const code = part.replace(/```\w*\n?/g, "").replace(/```/g, "");
          return <Text key={i} color="green" dimColor>{"\n" + code.split("\n").map((l) => "  │ " + l).join("\n") + "\n"}</Text>;
        }
        return <InlineMarkdown key={i} text={part} />;
      })}
    </React.Fragment>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const tokens = parseInline(text);
  return (
    <React.Fragment>
      {tokens.map((t, i) => {
        if (t.type === "bold") return <Text key={i} bold>{t.content}</Text>;
        if (t.type === "code") return <Text key={i} color="yellow">{t.content}</Text>;
        return <Text key={i}>{t.content}</Text>;
      })}
    </React.Fragment>
  );
}

interface InlineToken { type: "text" | "bold" | "code"; content: string; }

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/s);
    if (boldMatch) {
      if (boldMatch[1]) tokens.push({ type: "text", content: boldMatch[1] });
      tokens.push({ type: "bold", content: boldMatch[2] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/s);
    if (codeMatch) {
      if (codeMatch[1]) tokens.push({ type: "text", content: codeMatch[1] });
      tokens.push({ type: "code", content: codeMatch[2] });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    tokens.push({ type: "text", content: remaining });
    break;
  }
  return tokens;
}
