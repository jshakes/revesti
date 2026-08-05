"use client";

import { useMemo, useRef, useState } from "react";
import { diffWordsWithSpace } from "diff";
import { reconcile } from "@/lib/reconcile";

// No cost/token limit anymore (this all runs locally). This is purely a
// browser-performance safeguard for very large pastes.
const MAX_CHARS = 500000;
const HTML_LIKE = /<[a-z][\s\S]*>/i;

type Status = "idle" | "loading" | "success" | "error";

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(
    () => diffWordsWithSpace(before, after),
    [before, after],
  );
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t-2 border-line bg-panel p-3 font-[family-name:var(--font-mono)] text-sm leading-relaxed text-body-text">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? "bg-green-100 text-green-900"
              : part.removed
                ? "bg-red-100 text-red-900 line-through"
                : undefined
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}

function CharCounter({ count, id }: { count: number; id: string }) {
  const overCap = count > MAX_CHARS;
  return (
    <span
      id={id}
      aria-live="polite"
      className={`font-[family-name:var(--font-mono)] text-sm ${
        overCap ? "font-semibold text-red-700" : "text-body-text"
      }`}
    >
      {count.toLocaleString()} / {MAX_CHARS.toLocaleString()}
    </span>
  );
}

export default function Reconciler() {
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const overCapA = inputA.length > MAX_CHARS;
  const overCapB = inputB.length > MAX_CHARS;
  const bothFilled = inputA.trim().length > 0 && inputB.trim().length > 0;
  const canSubmit =
    bothFilled && !overCapA && !overCapB && status !== "loading";

  const looksLikeHtmlInB = useMemo(() => HTML_LIKE.test(inputB), [inputB]);

  async function submit() {
    setStatus("loading");
    setErrorMessage("");
    // Yield a tick so the loading state can paint before the (synchronous)
    // reconciliation work runs. Matters for very large pastes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const { html, warnings: w } = reconcile(inputA, inputB);
      setResult(html);
      setWarnings(w);
      setStatus("success");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setStatus("error");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    submit();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write failed silently; user can still select/copy manually
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12 sm:px-10">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-ink sm:text-4xl">
        HTML Translation Reconciler
      </h1>
      <p className="mt-3 max-w-2xl text-base text-body-text">
        Paste the auto-translated HTML on the left and the corrected
        plain-text translation on the right. Reconciling matches paragraphs
        by position and merges the corrected wording into the original tag
        structure. It runs entirely in your browser, so nothing you paste
        ever leaves your device.
      </p>

      <form onSubmit={handleSubmit} className="mt-8">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <label
                htmlFor="input-a"
                className="text-base font-semibold text-ink"
              >
                Step 1: Auto-translated HTML
              </label>
              <CharCounter count={inputA.length} id="input-a-counter" />
            </div>
            <textarea
              id="input-a"
              value={inputA}
              onChange={(e) => setInputA(e.target.value)}
              aria-describedby="input-a-counter"
              rows={12}
              className="w-full resize-y border-2 border-line bg-panel p-3 font-[family-name:var(--font-mono)] text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="<p>Some <strong>tagged</strong> text&hellip;</p>"
            />
            {overCapA && (
              <p role="alert" className="mt-1 text-sm font-semibold text-red-700">
                This input exceeds the {MAX_CHARS.toLocaleString()} character
                limit. Trim it before submitting.
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <label
                htmlFor="input-b"
                className="text-base font-semibold text-ink"
              >
                Step 2: Human-translated text (plain)
              </label>
              <CharCounter count={inputB.length} id="input-b-counter" />
            </div>
            <textarea
              id="input-b"
              value={inputB}
              onChange={(e) => setInputB(e.target.value)}
              aria-describedby="input-b-counter input-b-warning"
              rows={12}
              className="w-full resize-y border-2 border-line bg-panel p-3 font-[family-name:var(--font-mono)] text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="Some tagged text&hellip; (one paragraph per line)"
            />
            {overCapB && (
              <p role="alert" className="mt-1 text-sm font-semibold text-red-700">
                This input exceeds the {MAX_CHARS.toLocaleString()} character
                limit. Trim it before submitting.
              </p>
            )}
            <p id="input-b-warning" aria-live="polite" className="mt-1 text-sm font-medium text-amber-800">
              {looksLikeHtmlInB
                ? "This looks like it might contain HTML tags. Did you mean to paste it in Step 1?"
                : ""}
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-center">
          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={status === "loading"}
            className="border-2 border-accent bg-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:border-line disabled:bg-panel disabled:text-body-text"
          >
            {status === "loading" ? "Reconciling..." : "Reconcile →"}
          </button>
        </div>
      </form>

      {status === "error" && (
        <div
          role="alert"
          className="mt-6 border-2 border-red-700 bg-red-50 px-4 py-3 text-base text-red-900"
        >
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={submit}
            className="mt-2 font-semibold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {result && (
        <div className="mt-10">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-base font-semibold text-ink">
              Result: copy this into your CMS
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
                Automated. Check it before you publish.
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="border-2 border-accent bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark focus-visible:ring-2 focus-visible:ring-accent"
              >
                {copied ? "Copied ✓" : "Copy to clipboard"}
              </button>
            </div>
          </div>

          {warnings.length > 0 && (
            <ul className="mb-2 list-disc space-y-1 bg-amber-50 px-6 py-3 text-sm text-amber-900">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <textarea
            readOnly
            value={result}
            aria-label="Reconciled HTML output"
            rows={10}
            className="w-full resize-y border-2 border-line bg-code-bg p-3 font-[family-name:var(--font-mono)] text-sm text-code-text outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />

          <details className="mt-4 border-2 border-line">
            <summary className="cursor-pointer select-none px-3 py-2 text-base font-semibold text-ink hover:text-accent">
              Show diff from original HTML
            </summary>
            <DiffView before={inputA} after={result} />
          </details>
        </div>
      )}

      <section className="mt-12 border-t-2 border-line pt-8">
        <h2 className="font-[family-name:var(--font-heading)] text-2xl font-bold text-ink">
          How it works
        </h2>

        <p className="mt-4 max-w-3xl text-base text-body-text">
          Reconcile splits the plain-text translation into blocks by line
          break: one line per paragraph, heading, or list item. It also
          walks the HTML on the left and finds the same kind of blocks,
          based on the tags (paragraphs, headings, list items, and similar
          elements) rather than the wording.
        </p>

        <p className="mt-4 max-w-3xl text-base text-body-text">
          When the number of blocks on each side matches, each block is
          paired with the one in the same position. Any inline tags inside
          it, such as links or bold text, are placed back into the new
          wording at roughly the same relative position they held in the
          original, based on character length. This is why a link near the
          start of a sentence should still land near the start after
          reconciling.
        </p>

        <p className="mt-4 max-w-3xl text-base text-body-text">
          When the number of blocks does not match, for example because a
          paragraph was split into two, two paragraphs were combined, or a
          heading was added or removed, the tool falls back to aligning
          blocks by comparing their lengths and choosing the overall best
          fit. This is a length-based guess, not a reading of the actual
          words, so it can occasionally pair the wrong blocks, particularly
          when two unrelated sentences happen to be a similar length. A
          warning appears above the result whenever this fallback runs.
        </p>

        <p className="mt-4 max-w-3xl text-base text-body-text">
          One trade-off of this fallback: whenever a block is split or
          merged, its inline tags are not carried over. Only blocks matched
          one-to-one keep their original tags positioned inside the new
          wording.
        </p>

        <h3 className="mt-8 text-lg font-semibold text-ink">
          How to fix a bad result
        </h3>
        <p className="mt-3 max-w-3xl text-base text-body-text">
          Most problems trace back to the block counts not matching, which
          forces the length-based fallback instead of a certain one-to-one
          pairing. These changes to the input fix the underlying cause
          rather than just working around it:
        </p>
        <ul className="mt-3 max-w-3xl list-disc space-y-3 pl-5 text-base text-body-text">
          <li>
            <span className="font-semibold text-ink">
              Make the line count match the block count.
            </span>{" "}
            Count the paragraphs, headings, and list items in the HTML on
            the left, then edit the plain text on the right so it has
            exactly that many lines, in the same order, one block per line.
            This is the single most reliable fix: when the counts match
            exactly, every block is paired with certainty and its tags are
            preserved. It is worth doing even if it means putting a merged
            or split sentence back the way the original was structured.
          </li>
          <li>
            <span className="font-semibold text-ink">
              Join soft-wrapped paragraphs back into one line.
            </span>{" "}
            Text pasted from Word, Google Docs, or a spreadsheet cell often
            carries a line break in the middle of a paragraph that was
            never meant to be a real break. Delete that line break so the
            whole paragraph is on one line, or the aligner will treat it as
            two separate blocks.
          </li>
          <li>
            <span className="font-semibold text-ink">
              Keep a block with a link or bold text unsplit.
            </span>{" "}
            Inline tags only carry over on a one-to-one match. If a
            paragraph containing a link gets split or merged, the link is
            dropped from that block. Leave that paragraph as a single line
            in the translation, or add the link back into the result by
            hand afterward.
          </li>
          <li>
            <span className="font-semibold text-ink">
              Reorder lines if two blocks got swapped.
            </span>{" "}
            This happens when two unrelated lines are a similar length. Move
            the plain-text lines so they sit in the same order as their
            matching blocks in the HTML, rather than relying on the aligner
            to guess correctly.
          </li>
          <li>
            <span className="font-semibold text-ink">
              Check for a missing wrapper tag.
            </span>{" "}
            If a piece of text in Step 1 is not becoming its own block,
            confirm it is actually inside a paragraph, heading, or list tag.
            Bare text with no wrapping tag cannot be matched to anything.
          </li>
          <li>
            <span className="font-semibold text-ink">
              Split large pastes into smaller passes.
            </span>{" "}
            If the input is long enough that mismatches are hard to track
            down, reconcile it in smaller sections, a few blocks at a time,
            rather than the whole document at once.
          </li>
        </ul>

        <p className="mt-6 max-w-3xl text-base font-medium text-ink">
          Because the alignment is based on length and position rather than
          meaning, read through the result before pasting it into your CMS,
          particularly on any block called out by a warning.
        </p>
      </section>
    </main>
  );
}
