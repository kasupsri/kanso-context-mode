/**
 * Markdown-aware chunker that splits content at heading boundaries
 * while preserving code blocks intact.
 */

export interface Chunk {
  heading: string;
  level: number; // 1-6 for h1-h6, 0 for top-level content
  content: string;
  startLine: number;
  endLine: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const CODE_FENCE_RE = /^```/;

export function chunkMarkdown(text: string, maxChunkSize = 1500): Chunk[] {
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];
  let startLine = 0;
  let inCodeBlock = false;

  function flushChunk(endLine: number) {
    if (currentLines.length === 0) return;
    const content = currentLines.join('\n').trim();
    if (!content) return;

    // If chunk is larger than maxChunkSize, split it further
    if (content.length > maxChunkSize) {
      const subChunks = splitLargeChunk(
        content,
        maxChunkSize,
        currentHeading,
        currentLevel,
        startLine
      );
      chunks.push(...subChunks);
    } else {
      chunks.push({
        heading: currentHeading,
        level: currentLevel,
        content,
        startLine,
        endLine,
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Track code blocks — never split inside them
    if (CODE_FENCE_RE.test(line)) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const headingMatch = HEADING_RE.exec(line);
      if (headingMatch) {
        flushChunk(i - 1);
        currentHeading = headingMatch[2] ?? '';
        currentLevel = headingMatch[1]?.length ?? 0;
        currentLines = [line];
        startLine = i;
        continue;
      }
    }

    currentLines.push(line);
  }

  flushChunk(lines.length - 1);
  return chunks;
}

function splitLargeChunk(
  content: string,
  maxSize: number,
  heading: string,
  level: number,
  startLine: number
): Chunk[] {
  const chunks: Chunk[] = [];
  let remaining = content;
  let partIndex = 0;

  while (remaining.length > maxSize) {
    // Find a good split point (paragraph boundary, line boundary)
    let splitAt = maxSize;
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxSize);
    const lineBreak = remaining.lastIndexOf('\n', maxSize);

    if (paragraphBreak > maxSize * 0.5) {
      splitAt = paragraphBreak;
    } else if (lineBreak > maxSize * 0.5) {
      splitAt = lineBreak;
    }

    const chunkHeading = partIndex === 0 ? heading : `${heading} (part ${partIndex + 1})`;
    chunks.push({
      heading: chunkHeading,
      level,
      content: remaining.slice(0, splitAt).trim(),
      startLine: startLine + partIndex * 50,
      endLine: startLine + partIndex * 50 + 50,
    });

    remaining = remaining.slice(splitAt).trim();
    partIndex++;
  }

  if (remaining) {
    chunks.push({
      heading: partIndex === 0 ? heading : `${heading} (part ${partIndex + 1})`,
      level,
      content: remaining,
      startLine: startLine + partIndex * 50,
      endLine: startLine + partIndex * 50 + 50,
    });
  }

  return chunks;
}

export function reconstructFromChunks(chunks: Chunk[]): string {
  return chunks
    .map(c => {
      if (c.level > 0) {
        return `${'#'.repeat(c.level)} ${c.heading}\n\n${c.content}`;
      }
      return c.content;
    })
    .join('\n\n');
}
