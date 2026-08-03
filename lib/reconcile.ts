export interface ReconcileResult {
  html: string;
  warnings: string[];
}

const INLINE_TAGS = new Set([
  "a", "strong", "b", "em", "i", "span", "sup", "sub", "u", "mark", "small",
  "abbr", "code", "br", "cite", "q", "kbd", "samp", "var", "time", "wbr",
  "del", "ins", "s", "strike", "big", "tt", "font",
]);

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "iframe", "object", "canvas",
]);

function isInlineTag(tagName: string): boolean {
  return INLINE_TAGS.has(tagName.toLowerCase());
}

interface Block {
  element: Element;
}

function collectBlocks(node: Element, blocks: Block[]) {
  const blockChildren = Array.from(node.children).filter(
    (el) => !isInlineTag(el.tagName) && !SKIP_TAGS.has(el.tagName.toLowerCase()),
  );
  if (blockChildren.length === 0) {
    if ((node.textContent || "").trim().length > 0) {
      blocks.push({ element: node });
    }
    return;
  }
  for (const child of blockChildren) {
    collectBlocks(child, blocks);
  }
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "el"; tag: string; attrs: [string, string][]; children: Segment[] };

function toSegments(node: Element): Segment[] {
  const segments: Segment[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      segments.push({ kind: "text", text: child.textContent || "" });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      segments.push({
        kind: "el",
        tag: el.tagName.toLowerCase(),
        attrs: Array.from(el.attributes).map((a) => [a.name, a.value]),
        children: toSegments(el),
      });
    }
  });
  return segments;
}

function segLength(seg: Segment): number {
  if (seg.kind === "text") return seg.text.length;
  return seg.children.reduce((sum, c) => sum + segLength(c), 0);
}

function isAnyBoundary(text: string, p: number): boolean {
  if (p <= 0 || p >= text.length) return true;
  return /\s/.test(text[p - 1]) || /\s/.test(text[p]);
}

// "Clean" boundary where the space sits on a specific side of the cut —
// used to keep whitespace out of inline elements (a trailing/leading space
// inside <a>/<strong> is valid HTML but looks sloppy and can pick up
// unwanted hover/underline styling).
function isSpaceAfter(text: string, p: number): boolean {
  if (p <= 0 || p >= text.length) return true;
  return !/\s/.test(text[p - 1]) && /\s/.test(text[p]);
}
function isSpaceBefore(text: string, p: number): boolean {
  if (p <= 0 || p >= text.length) return true;
  return /\s/.test(text[p - 1]) && !/\s/.test(text[p]);
}

function findNear(
  text: string,
  pos: number,
  window: number,
  check: (t: string, p: number) => boolean,
): number | null {
  if (check(text, pos)) return pos;
  for (let d = 1; d <= window; d++) {
    if (pos - d >= 0 && check(text, pos - d)) return pos - d;
    if (pos + d <= text.length && check(text, pos + d)) return pos + d;
  }
  return null;
}

// Nudges a proportional cut point to a nearby word boundary so inline tags
// don't split a word in half. `preferSpaceAfter` biases which side of the
// boundary keeps the whitespace: true keeps the ending segment (typically
// an inline element) clean of trailing space, false keeps the starting
// segment clean of leading space, null means no preference either way.
function snapToWordBoundary(
  text: string,
  pos: number,
  preferSpaceAfter: boolean | null,
  window = 20,
): number {
  if (preferSpaceAfter === true) {
    const r = findNear(text, pos, window, isSpaceAfter);
    if (r !== null) return r;
  } else if (preferSpaceAfter === false) {
    const r = findNear(text, pos, window, isSpaceBefore);
    if (r !== null) return r;
  }
  const r2 = findNear(text, pos, window, isAnyBoundary);
  return r2 !== null ? r2 : pos;
}

// Distributes newText across the same segment shape as `segments`, scaling
// each segment's original character span proportionally into newText. This
// is the "character length" heuristic that keeps inline tags (links, bold,
// etc.) roughly where they were, without any semantic understanding of the
// translated wording.
function remapSegments(segments: Segment[], newText: string): Segment[] {
  const totalOrigLen = segments.reduce((s, seg) => s + segLength(seg), 0);
  const newLen = newText.length;
  if (totalOrigLen === 0) {
    return newLen > 0 ? [{ kind: "text", text: newText }] : [];
  }

  const result: Segment[] = [];
  let origCursor = 0;
  let newCursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    origCursor += segLength(seg);
    const isLast = i === segments.length - 1;
    let targetEnd = isLast
      ? newLen
      : Math.round((origCursor / totalOrigLen) * newLen);
    if (!isLast) {
      const nextSeg = segments[i + 1];
      const preferSpaceAfter =
        seg.kind === "el" ? true : nextSeg?.kind === "el" ? false : null;
      // Cap the snap search to roughly half this segment's own proportional
      // width — otherwise a short inline element (e.g. a 3-character link
      // inside a much longer sentence) can get snapped past its entire
      // target range and collapse to empty content.
      const rawWidth = Math.max(1, targetEnd - newCursor);
      const window = Math.min(20, Math.max(2, Math.floor(rawWidth / 2)));
      const beforeSnap = targetEnd;
      const snapped = snapToWordBoundary(newText, targetEnd, preferSpaceAfter, window);
      // Guard: the fallback "any boundary" search inside snapToWordBoundary
      // can still land behind newCursor (e.g. snapping back to the space
      // that starts this very segment), collapsing a real segment to
      // nothing. If that happens, prefer a mid-word cut over losing the
      // segment's content entirely.
      targetEnd = snapped <= newCursor && beforeSnap > newCursor ? beforeSnap : snapped;
    }
    targetEnd = Math.max(newCursor, Math.min(newLen, targetEnd));

    const pieceText = newText.slice(newCursor, targetEnd);
    if (seg.kind === "text") {
      result.push({ kind: "text", text: pieceText });
    } else {
      result.push({
        kind: "el",
        tag: seg.tag,
        attrs: seg.attrs,
        children: remapSegments(seg.children, pieceText),
      });
    }
    newCursor = targetEnd;
  }
  return result;
}

function buildDom(doc: Document, segments: Segment[]): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const seg of segments) {
    if (seg.kind === "text") {
      if (seg.text.length > 0) frag.appendChild(doc.createTextNode(seg.text));
    } else {
      const el = doc.createElement(seg.tag);
      for (const [name, value] of seg.attrs) el.setAttribute(name, value);
      el.appendChild(buildDom(doc, seg.children));
      frag.appendChild(el);
    }
  }
  return frag;
}

function applyMatch(block: Block, newText: string, doc: Document) {
  const segments = toSegments(block.element);
  const remapped = remapSegments(segments, newText);
  block.element.textContent = "";
  block.element.appendChild(buildDom(doc, remapped));
}

interface AlignGroup {
  aIdx: number[];
  bIdx: number[];
}

const MAX_GROUP = 3;
const INSERT_PENALTY = 0.9;
const DELETE_PENALTY = 0.9;

function lengthCost(aLens: number[], bLens: number[], aTags: string[]): number {
  const aTotal = aLens.reduce((s, x) => s + x, 0);
  const bTotal = bLens.reduce((s, x) => s + x, 0);
  const denom = Math.max(aTotal, bTotal, 1);
  const diff = Math.abs(aTotal - bTotal) / denom;
  // Small penalty per extra block on either side of the group, so the
  // aligner only splits/merges when the length evidence actually favors it.
  const groupPenalty = 0.08 * (aLens.length - 1) + 0.08 * (bLens.length - 1);
  // Merging/splitting across different original tag types (e.g. a heading
  // absorbed into a paragraph) is structurally much less likely than doing
  // so within the same tag type — discourage it even when lengths happen
  // to line up, since there's no semantic understanding to fall back on.
  const heterogeneityPenalty = new Set(aTags).size > 1 ? 1.0 : 0;
  return diff + groupPenalty + heterogeneityPenalty;
}

// Sequence alignment (Needleman-Wunsch style) over block lengths: finds the
// lowest-cost way to pair up source blocks with translated lines, allowing
// 1:1 matches, 1:many splits, many:1 merges, and unmatched inserts/deletes —
// covering paragraph splits/merges and added/removed headings.
function alignBlocks(
  aLens: number[],
  bLens: number[],
  aTags: string[],
): AlignGroup[] {
  const nA = aLens.length;
  const nB = bLens.length;
  const INF = Infinity;
  const dp: number[][] = Array.from({ length: nA + 1 }, () =>
    new Array(nB + 1).fill(INF),
  );
  const choice: ({ pi: number; pj: number } | null)[][] = Array.from(
    { length: nA + 1 },
    () => new Array(nB + 1).fill(null),
  );
  dp[0][0] = 0;

  for (let i = 0; i <= nA; i++) {
    for (let j = 0; j <= nB; j++) {
      const cur = dp[i][j];
      if (cur === INF) continue;

      if (i < nA) {
        const cost = cur + DELETE_PENALTY;
        if (cost < dp[i + 1][j]) {
          dp[i + 1][j] = cost;
          choice[i + 1][j] = { pi: i, pj: j };
        }
      }
      if (j < nB) {
        const cost = cur + INSERT_PENALTY;
        if (cost < dp[i][j + 1]) {
          dp[i][j + 1] = cost;
          choice[i][j + 1] = { pi: i, pj: j };
        }
      }
      for (let da = 1; da <= Math.min(MAX_GROUP, nA - i); da++) {
        for (let db = 1; db <= Math.min(MAX_GROUP, nB - j); db++) {
          if (da > 1 && db > 1) continue; // only 1:1, 1:many, many:1
          const cost =
            cur +
            lengthCost(
              aLens.slice(i, i + da),
              bLens.slice(j, j + db),
              aTags.slice(i, i + da),
            );
          if (cost < dp[i + da][j + db]) {
            dp[i + da][j + db] = cost;
            choice[i + da][j + db] = { pi: i, pj: j };
          }
        }
      }
    }
  }

  const groups: AlignGroup[] = [];
  let i = nA;
  let j = nB;
  while (i > 0 || j > 0) {
    const c = choice[i][j];
    if (!c) break;
    const { pi, pj } = c;
    const aIdx: number[] = [];
    for (let k = pi; k < i; k++) aIdx.push(k);
    const bIdx: number[] = [];
    for (let k = pj; k < j; k++) bIdx.push(k);
    groups.push({ aIdx, bIdx });
    i = pi;
    j = pj;
  }
  groups.reverse();
  return groups;
}

function greedyAlign(nA: number, nB: number): AlignGroup[] {
  const groups: AlignGroup[] = [];
  const n = Math.min(nA, nB);
  for (let k = 0; k < n; k++) groups.push({ aIdx: [k], bIdx: [k] });
  for (let k = n; k < nA; k++) groups.push({ aIdx: [k], bIdx: [] });
  for (let k = n; k < nB; k++) groups.push({ aIdx: [], bIdx: [k] });
  return groups;
}

export function reconcile(sourceHtml: string, humanText: string): ReconcileResult {
  const warnings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<div id="__reconcile_root__">${sourceHtml}</div>`,
    "text/html",
  );
  const root = doc.getElementById("__reconcile_root__");
  if (!root) {
    throw new Error("Could not parse the source HTML.");
  }

  const blocks: Block[] = [];
  collectBlocks(root, blocks);
  if (blocks.length === 0) {
    throw new Error("No text content found in the HTML input.");
  }

  const bTexts = humanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (bTexts.length === 0) {
    throw new Error("No text content found in the plain-text input.");
  }

  let groups: AlignGroup[];
  if (blocks.length === bTexts.length) {
    groups = blocks.map((_, idx) => ({ aIdx: [idx], bIdx: [idx] }));
  } else {
    warnings.push(
      `Source has ${blocks.length} block${blocks.length === 1 ? "" : "s"} but the translation has ${bTexts.length} line${bTexts.length === 1 ? "" : "s"}. They were aligned automatically by matching length and order, so please review the result carefully.`,
    );
    const aLens = blocks.map((b) => (b.element.textContent || "").length);
    const bLens = bTexts.map((t) => t.length);
    const aTags = blocks.map((b) => b.element.tagName.toLowerCase());
    if (aLens.length * bLens.length > 200000) {
      groups = greedyAlign(aLens.length, bLens.length);
      warnings.push(
        "Input is large, so a simplified positional alignment was used instead of full matching.",
      );
    } else {
      groups = alignBlocks(aLens, bLens, aTags);
    }
  }

  let lastProcessedElement: Node | null = null;

  for (let gi = 0; gi < groups.length; gi++) {
    const { aIdx, bIdx } = groups[gi];

    if (aIdx.length === 1 && bIdx.length === 1) {
      applyMatch(blocks[aIdx[0]], bTexts[bIdx[0]], doc);
      lastProcessedElement = blocks[aIdx[0]].element;
      continue;
    }

    if (aIdx.length === 0) {
      const newEl = doc.createElement("p");
      newEl.textContent = bIdx.map((i) => bTexts[i]).join(" ");
      if (lastProcessedElement && lastProcessedElement.parentNode) {
        lastProcessedElement.parentNode.insertBefore(
          newEl,
          lastProcessedElement.nextSibling,
        );
      } else {
        let anchor: Element | null = null;
        for (let gj = gi + 1; gj < groups.length; gj++) {
          if (groups[gj].aIdx.length > 0) {
            anchor = blocks[groups[gj].aIdx[0]].element;
            break;
          }
        }
        if (anchor && anchor.parentNode) {
          anchor.parentNode.insertBefore(newEl, anchor);
        } else {
          root.appendChild(newEl);
        }
      }
      lastProcessedElement = newEl;
      continue;
    }

    if (bIdx.length === 0) {
      for (const idx of aIdx) blocks[idx].element.remove();
      continue;
    }

    const templateBlock = blocks[aIdx[0]];
    if (bIdx.length === 1) {
      templateBlock.element.textContent = bTexts[bIdx[0]];
      for (let k = 1; k < aIdx.length; k++) blocks[aIdx[k]].element.remove();
      lastProcessedElement = templateBlock.element;
    } else {
      const parent = templateBlock.element.parentNode;
      if (!parent) continue;
      const clones: Element[] = bIdx.map((bi) => {
        const clone = templateBlock.element.cloneNode(false) as Element;
        clone.textContent = bTexts[bi];
        return clone;
      });
      for (const c of clones) parent.insertBefore(c, templateBlock.element);
      parent.removeChild(templateBlock.element);
      lastProcessedElement = clones[clones.length - 1];
    }
  }

  return { html: (root.innerHTML || "").trim(), warnings };
}
