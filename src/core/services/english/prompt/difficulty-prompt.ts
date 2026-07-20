import type { DifficultyContext } from './vocab-prompt';

export function buildDifficultyInstruction(ctx: DifficultyContext): string {
  const wrongAnswerCount = ctx.optionCount - 1;

  const levelDesc: Record<DifficultyContext['engLevel'], string> = {
    A1: 'beginner — use very common, everyday words (top 1000 most frequent English words)',
    A2: 'elementary — use common words found in daily conversations and simple texts',
    B1: 'intermediate — use upper-intermediate vocabulary including academic and professional terms',
    B2: 'upper-intermediate — use advanced vocabulary with nuanced meanings, idiomatic expressions, and sophisticated collocations'
  };

  const distractorDesc: Record<DifficultyContext['engLevel'], string> = {
    A1: 'wrong answers should be clearly different in meaning — easy to distinguish for a beginner',
    A2: 'wrong answers should require some thought — plausible but distinguishable with basic knowledge',
    B1: 'wrong answers should be near-synonyms or words with overlapping collocations — requires careful thinking',
    B2: 'wrong answers should be very close in meaning, register, or usage — only nuanced differences separate them'
  };

  return `
Learner difficulty context:
- English level: ${ctx.engLevel} (CEFR) — ${levelDesc[ctx.engLevel]}
- wrongAnswers: generate exactly ${wrongAnswerCount} items
- Distractor difficulty: ${distractorDesc[ctx.engLevel]}

EXPERT LEARNER MODE — MAXIMUM DIFFICULTY (overrides standard distractor rules above):
This learner is highly proficient. The quiz must challenge even advanced learners who know common synonyms.
- correctAnswer: must be extremely precise — include connotation, register constraint, and collocational context in the Vietnamese meaning
  (e.g. instead of "giảm dần", write "giảm dần không thể kiểm soát, thường dùng cho nguồn lực hoặc cảm xúc, mang sắc thái bi quan")
- wrongAnswers: must be near-synonyms in Vietnamese — differ from the correct answer only by subtle semantic, collocational, or pragmatic nuance
  — every option must feel plausible to an intermediate learner; no obviously wrong distractors allowed
  — distractor difficulty applies at maximum: near-identical register, overlapping usage contexts
- exampleSentence: use grammatically complex sentences (passive constructions, inversions, cleft sentences, conditionals, participial phrases, etc.)
- explanation: go beyond basic meaning — analyze collocational behavior, register constraints, and explicitly compare the word against the wrong answer candidates

Special rule — specialized/technical vocabulary override:
If the chosen word is a specialized or technical term (e.g. medical, legal, scientific, academic jargon, or domain-specific terminology not commonly known outside its field), IGNORE the expert mode above and instead apply the easiest setting:
- Use the simplest, most accessible Vietnamese explanation possible
- wrongAnswers should be clearly and obviously wrong — easy to eliminate even without domain knowledge
- The example sentence should use plain, everyday context (not technical)
- Do NOT assume the learner has any background in that field`;
}
