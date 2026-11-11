/*
 * Marking an activity on the computer, with no internet.
 *
 * The same rules as the website (apps/echospell/marking.py in the Django
 * project): forgiving about what isn't being tested (capitals, stray
 * punctuation, the slashes round a transcription, doubled spaces), strict
 * about what is (a missing length mark turns "sheep" into "ship"). If the
 * website's rules change, change them here too.
 *
 * The answers come from the release (/_dm/answers.json, written by the
 * website's export): {activity page: {kind, mode, pass_mark, items}}.
 *
 * Pure functions only, so they run under `npm test` without Electron.
 */
"use strict";

const PUNCTUATION = /[.,!?;:"“”‘’()[\]]/g;
const WHITESPACE = /\s+/g;
const IPA_WRAPPER = /^[/[]+|[/\]]+$/g;
const STRESS = /[ˈˌ']/g;
const LIST_MARKER = /^\s*(?:\d+\s*[.)\-:]|[-*•])\s*/;

function casefold(text) {
  return String(text).toLowerCase().replace(/ß/g, "ss");
}

function normalise(text) {
  let value = casefold(String(text == null ? "" : text).normalize("NFKC"));
  value = value.replace(PUNCTUATION, " ");
  return value.replace(WHITESPACE, " ").trim();
}

function ipaForms(text) {
  let base = String(text == null ? "" : text).normalize("NFKC").trim();
  base = base.replace(IPA_WRAPPER, "");
  base = casefold(base.replace(WHITESPACE, ""));
  return new Set([base, base.replace(STRESS, "")]);
}

function answersMatch(given, answers, transcription) {
  given = String(given || "").trim();
  if (!given) return false;
  if (transcription) {
    const forms = ipaForms(given);
    return answers.some((option) => [...ipaForms(option)].some((form) => forms.has(form)));
  }
  const wanted = normalise(given);
  return answers.some((option) => normalise(option) === wanted);
}

function parseLines(raw) {
  return String(raw || "").replace(/\r\n/g, "\n").split("\n")
    .map((line) => line.replace(LIST_MARKER, "").trim()).filter(Boolean);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gradeSentenceUse(word, sentence) {
  const text = String(sentence || "").trim();
  if (!text) return [false, "Write a sentence before checking it."];
  const lower = casefold(String(word || "").trim());
  if (lower && !new RegExp("(^|[^\\p{L}\\p{N}_])" + escapeRegExp(lower) + "($|[^\\p{L}\\p{N}_])", "u").test(casefold(text))) {
    return [false, `Your sentence should use the word "${word}".`];
  }
  if (text.split(/\s+/).length < 3) return [false, "Try writing a full sentence, not just the word."];
  return [true, "Well done — that's a good sentence!"];
}

function circled(given) {
  return new Set(String(given || "").split(",").map(normalise).filter(Boolean));
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** true, false, or null when only a teacher can mark it (a recording). */
function markResponse(activity, item, given) {
  if (!activity || activity.mode === "record" || !activity.mode) return null;
  given = String(given || "").trim();
  if (!given) return false;
  const answers = item.answers || [];
  switch (activity.kind) {
    case "word-to-sentence":
      return gradeSentenceUse(item.word || "", given)[0];
    case "transcription":
      return answersMatch(given, answers, true);
    case "listen-and-number": {
      const wanted = normalise(given);
      const lists = item.lists || answers.map(parseLines);
      return lists.some((list) => normalise(list.join(" ")) === wanted);
    }
    case "listen-and-circle": {
      const marked = circled(given);
      const lists = item.lists || answers.map(parseLines);
      return lists.some((list) => sameSet(marked, new Set(list.map(normalise))));
    }
    default:
      if (["typed", "choice", "sort", "order", "search"].includes(activity.mode)) return answersMatch(given, answers, false);
      return null;
  }
}

function feedbackFor(activity, item, given, isCorrect) {
  if (isCorrect === null) return "Saved on this computer. Your teacher can listen to it here.";
  if (isCorrect) return "Correct";
  if (activity.kind === "word-to-sentence") return gradeSentenceUse(item.word || "", given)[1];
  if (activity.mode === "search") return `You didn't find ${item.first}.`;
  if (!String(given || "").trim()) return "You left this one blank.";
  if (activity.kind === "listen-and-number") return "The order was " + parseLines(item.first).join(", ");
  if (activity.kind === "listen-and-circle") {
    const words = parseLines(item.first);
    return (words.length > 1 ? "The words to circle were " : "The word to circle was ") + words.join(", ");
  }
  return `The answer is ${item.first}`;
}

/** Python's round(): halves go to the even number, so 12.5% is 12% here too. */
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

/** What the learner sent for one question: several values (Listen and circle) kept as "a, b". */
function givenAnswer(fields, itemId) {
  const values = (fields[`item-${itemId}`] || []).map((value) => String(value).trim()).filter(Boolean);
  return values.join(", ").slice(0, 1000);
}

/**
 * Mark a whole attempt, as the website's ActivityAttempt.recalculate does.
 * fields: {name: [values]} from the form; recorded: set of item ids with a recording.
 */
function markAttempt(activity, fields, recorded) {
  const rows = activity.items.map((item) => {
    const given = givenAnswer(fields, item.id);
    const isCorrect = activity.mode === "record" ? null : markResponse(activity, item, given);
    return { id: item.id, given, correct: isCorrect, recorded: Boolean(recorded && recorded.has(String(item.id))),
             feedback: feedbackFor(activity, item, given, isCorrect) };
  });
  const marked = rows.filter((row) => row.correct !== null);
  const max = marked.length;
  const score = marked.filter((row) => row.correct).length;
  const percent = max ? roundHalfEven((score * 100) / max) : 0;
  return {
    title: activity.title, score, max, percent,
    passed: Boolean(max) && percent >= (activity.pass_mark || 0),
    status: max ? "marked" : "awaiting",
    pass_mark: activity.pass_mark || 0,
    rows,
  };
}

module.exports = { normalise, ipaForms, answersMatch, parseLines, gradeSentenceUse, markResponse, feedbackFor, givenAnswer, markAttempt };
