import type { DifficultyContext } from './vocab-prompt';

export interface DescriptionQuestion {
  description: string;
  descriptionLanguage: 'vi' | 'en';
  partOfSpeech: 'noun' | 'verb' | 'adjective';
  correctAnswer: string;
  wrongAnswers: string[];
  wrongAnswerExplanations: string[];
  explanation: string;
  exampleSentence: string;
  exampleTranslation: string;
}

const EXAMPLE_WRONG_ANSWERS = ['charger', 'wallet', 'umbrella', 'notebook'];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Charger dùng để sạc thiết bị, còn ngữ cảnh này nói về thứ bạn dùng để mở cửa — hai vật này không thay thế cho nhau được.',
  'Wallet dùng để giữ tiền và thẻ, còn ngữ cảnh này nói về thứ mở khóa cửa — mục đích sử dụng hoàn toàn khác.',
  'Umbrella dùng khi trời mưa hoặc nắng, còn ngữ cảnh này cần một vật để mở cửa — không liên quan đến thời tiết.',
  'Notebook dùng để ghi chép, còn ngữ cảnh này cần một vật để mở khóa cửa — chức năng hoàn toàn khác.'
];

function buildExclusionBlock(excludeWords: string[]): string {
  if (excludeWords.length === 0) return '';
  const list = excludeWords.map((w, i) => `  ${i + 1}. "${w}"`).join('\n');
  return `
WORD EXCLUSION — ABSOLUTE HARD BLOCK:
The following words have been used recently and are FORBIDDEN as the "correctAnswer" field:
${list}
Using any word from this list is a critical failure — the quiz will be discarded.
Before writing "correctAnswer", mentally check: "Is this word in the forbidden list?" → If YES or SIMILAR → choose again.
Do NOT pick a near-variant, inflected form, spelling variant, or semantic twin.

`;
}

function buildLanguageRule(engLevel: DifficultyContext['engLevel']): string {
  if (engLevel === 'A1') {
    return 'For A1, about 70% of generated descriptions should be Vietnamese ("vi") and about 30% English ("en").';
  }
  if (engLevel === 'A2') {
    return 'For A2, about 50% of generated descriptions should be Vietnamese ("vi") and about 50% English ("en").';
  }
  return `For ${engLevel}, descriptions MUST be English ("en"). Do not use Vietnamese descriptions for B1 or B2.`;
}

export function buildDescriptionPrompt(
  wrongAnswerCount: number,
  options?: {
    count?: number;
    topic?: string;
    excludeWords?: string[];
    engLevel?: DifficultyContext['engLevel'];
  }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludeWords = options?.excludeWords ?? [];
  const engLevel = options?.engLevel ?? 'A1';
  const wrongAnswers = EXAMPLE_WRONG_ANSWERS.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);
  const exclusionBlock = buildExclusionBlock(excludeWords);

  const batchBlock =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Choose a fresh target word and a fresh real-life use case for each item
  - Build the final description AGAINST the actual wrongAnswers so only correctAnswer can fit
  - Each item must pass the no-definition, no-leak, and single-correct-answer self-checks
  - Each item must have specific wrongAnswerExplanations citing exact context clues
  - Each item must use a different everyday scenario and description pattern

UNIQUENESS:
  - No two items share the same correctAnswer, near-variant, or central use case
  - No two descriptions use the same sentence frame or scenario
  - Vary partOfSpeech across noun, verb, and adjective when possible
  - Follow the descriptionLanguage distribution for the whole batch, not by copying the same language every time unless the level requires English only

COMMON BATCH FAILURES — avoid:
  - Writing dictionary definitions for later items
  - Reusing the same distractor set across items
  - Making every description start with the same template ("You use...", "You feel...", "You do...", "Bạn dùng...", "Bạn cảm thấy...")
  - Copying sentence frames from examples instead of inventing a fresh scene
  - Writing a broad event that could support several emotion adjectives
  - Letting correctAnswer, an English synonym, a Vietnamese translation, or near-translation appear inside the description

BATCH STYLE DIVERSITY:
  - No more than ONE item may start with the same first two words
  - Across the batch, mix scene snapshots, mini-dialogue, problem-solution, physical cues, social situations, and action consequences
  - Examples in this prompt are scaffolding only; never copy their sentence frames
`
      : '';

  const topicBlock = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "correctAnswer": must be a word naturally used in, or strongly associated with, "${topic}" situations
  - "description": must describe a real-life use case, feeling, action, or situation inside the "${topic}" domain
  - "exampleSentence": must depict a scenario clearly situated in a "${topic}" context
DO NOT generate a question where the target word is unrelated to "${topic}" and merely rescued by a topic-flavored sentence. If the word does not naturally belong to "${topic}", choose a different word entirely.
Wrong answers are EXEMPT from the topic constraint, but they must remain plausible options with the same part of speech.
`
    : '';

  const singleSchema = `{
  "description": string,
  "descriptionLanguage": "vi" | "en",
  "partOfSpeech": "noun" | "verb" | "adjective",
  "correctAnswer": string,
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`;

  const outputInstruction =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] } (no explanation, no markdown):\n${singleSchema}`
      : `Return ONLY valid JSON matching this exact schema (no explanation, no markdown):\n${singleSchema}`;

  return `You are an English real-life description quiz generator for Vietnamese learners.
${batchBlock}${topicBlock}
You will choose one English word (noun, verb, or adjective), then write a short real-life use case or spoken-context clue. The learner sees the description and must choose the matching English word.
${exclusionBlock}
CRITICAL: "wrongAnswers" and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

LANGUAGE RULE:
- Current level: ${engLevel}
- ${buildLanguageRule(engLevel)}
- "descriptionLanguage" must accurately label the language used in "description".

${outputInstruction}

SINGLE-CORRECT-ANSWER CONTRACT — MOST IMPORTANT RULE:
- First choose correctAnswer and wrongAnswers.
- Then write or revise "description" until every wrongAnswer is clearly ruled out by the SAME context.
- The description must contain concrete disambiguating anchors: visible behavior, physical state, emotional direction, tool function, outcome, cause, constraint, or goal.
- A broad event alone is NOT enough if different people could reasonably react in different ways.
- If any wrongAnswer could still be defended as correct by adding a normal interpretation, regenerate the entire item.
- Do NOT rely on the result canvas explanation to disambiguate; the learner must be able to choose the only correct answer from the description itself.
- BAD: "Bạn cảm thấy thế nào khi đội bóng yêu thích của mình ghi bàn thắng quyết định vào phút cuối?" This could be elated, relieved, anxious, surprised, or confused depending on the person.
- GOOD: "Bạn bật dậy reo hò, cười lớn và thấy cực kỳ phấn khích khi đội mình ghi bàn thắng quyết định vào phút cuối." This clearly points to "elated" and rules out anxious, exhausted, confused.

ANSWER-LEAK PREVENTION — DESCRIPTION MUST NOT GIVE AWAY THE OPTION:
- "description" is ONLY a clue/context. It must NOT include the UI question line.
- Do NOT write "Which word...", "Từ nào...", "Chọn từ...", or any direct instruction inside "description"; the app adds that separately.
- Before writing "description", privately list forbidden clue terms for correctAnswer:
  1. correctAnswer itself
  2. inflections and spelling variants
  3. obvious English synonyms
  4. Vietnamese translation and near-translation
  5. topic-specific Vietnamese labels that directly name the answer
- None of those forbidden terms may appear in "description".
- BAD for correctAnswer "stadium": "Bạn đang đứng ở sân vận động..." because "sân vận động" is the direct Vietnamese translation.
- GOOD for correctAnswer "stadium": "Bạn đang ở một nơi có khán đài lớn, đèn chiếu sáng, tiếng cổ vũ vang khắp nơi, và trận bóng đang diễn ra trước rất nhiều khán giả."
- BAD for correctAnswer "field": "Các cầu thủ chạy trên sân cỏ..." because "sân" directly points to field.
- GOOD for correctAnswer "field": "Các cầu thủ đang chuyền bóng trên khu vực cỏ rộng có vạch trắng và khung thành ở hai đầu."

TYPE CORE RULES:
- "description": the learner-facing clue.
  - Must be a real-life context, use case, feeling, action, or spoken situation.
  - Must be specific enough that exactly one option is defensible.
  - Must be clue-only: no question sentence, no instruction sentence, no "choose the word" wording.
  - Must NOT be a formal dictionary definition.
  - Must NOT use patterns like "a device used for...", "a person who...", "an object that...", "the act of...", "the quality of...".
  - Must NOT ask a bare subjective question such as "How do you feel when..." or "Bạn cảm thấy thế nào khi..." unless the same sentence also gives concrete emotional/behavioral cues that rule out all wrong options.
  - Must NOT reveal correctAnswer, an inflection, a spelling variant, a near-synonym, the Vietnamese translation, or a near-translation that makes the answer too obvious.
  - Do NOT default to sentence starters like "You use...", "You feel...", "You do...", "Bạn dùng...", "Bạn cảm thấy...", or "Bạn làm..." — they are allowed occasionally, but they must NOT become the default format.
  - The sample clue styles below are examples of variety, NOT templates to copy.
  - BAD style: "a device used for charging...", "a person who studies...", "an adjective meaning nervous..."
- "partOfSpeech": exactly one of "noun", "verb", "adjective".
- "correctAnswer": one English vocab item that uniquely matches the description.
  - Must be a common real English word.
  - Must be the same part of speech as partOfSpeech.
  - Must NOT be a proper noun, brand, place name, person name, or product name.
  - Must be noun/adjective/verb only; no phrase, idiom, slang-only expression, phrasal verb, or multi-word answer.
- "wrongAnswers": EXACTLY ${wrongAnswerCount} English words.
  - Same part of speech, similar difficulty, and similar answer style as correctAnswer.
  - Plausible at a glance, but definitively wrong for this exact description.
  - Must NOT be synonyms, near-synonyms, broader categories, narrower examples, or words that could fit a second valid interpretation.
  - Must NOT be proper nouns.
- "wrongAnswerExplanations": EXACTLY ${wrongAnswerCount} Vietnamese explanations, same order as wrongAnswers.
  - Explain the concrete conflict with the exact description.
  - Must quote or paraphrase the specific context clue that rules out that wrong option (behavior, physical state, goal, tool function, outcome, emotional direction, etc.).
  - If you cannot name a specific clue that rules out a wrong option, the description is too ambiguous — rewrite the item.
  - Do NOT just say the meaning is different.
  - No markdown.
- "explanation": 1-2 friendly Vietnamese sentences.
  - Explain why correctAnswer fits this real-life clue and mention usage nuance if helpful.
  - Do NOT include the example sentence here.
  - No markdown.
- "exampleSentence": one natural English sentence using correctAnswer in a daily-life context.
  - Must use correctAnswer verbatim, with natural inflection only when grammatically necessary.
  - Must NOT copy the description sentence.
- "exampleTranslation": natural Vietnamese translation of exampleSentence.

DISTRACTOR QUALITY:
- Every wrong answer must be plausible enough that the learner has to read the clue.
- Every wrong answer must be impossible to defend as correct for the exact clue.
- For B1/B2, distractors may be close in domain or collocation, but the clue must still leave only one correct option.

ADJECTIVE AND EMOTION RULES:
- For adjective questions, especially emotions, never use only the event as the clue.
- Include at least one observable or internal-state anchor:
  - positive high energy: cheering, smiling, celebrating, proud, thrilled, jumping up
  - anxiety/fear: worrying, hands shaking, heart racing, uncertain outcome, unable to relax
  - exhaustion: no energy, heavy body, wanting to sleep, after intense effort
  - confusion: not understanding, unsure what is happening, mixed-up instructions
- If correctAnswer is positive, the description must contain positive cues. If a wrongAnswer is negative, the description must explicitly conflict with that negative state, and vice versa.
- Do not use "How do you feel when..." / "Bạn cảm thấy thế nào khi..." as the main clue unless it is followed by concrete cues like "bạn reo hò vì quá vui" or "tay bạn run vì lo".

CREATIVE CLUE STYLE MENU — ROTATE THESE NATURALLY:
- Scene snapshot: "The room goes quiet after the lights suddenly go out."
- Mini-dialogue: "Your friend whispers, 'Please don't tell anyone about this.'"
- Problem-solution: "Your laptop is about to die, so you reach into your bag before the meeting starts."
- Physical cue: "Your hands shake while you wait for the exam results."
- Social situation: "At the counter, the cashier gives back too much money by mistake."
- Action consequence: "After running for ten minutes, your legs feel heavy and you want to sit down."
- Object/function hint without dictionary wording: "You are outside your apartment, checking every pocket before you can get in."
- Place clue without direct translation: "Thousands of fans sit around the pitch, lights shine overhead, and the match is about to begin."

LEVEL-SENSITIVE STYLE:
- A1/A2: keep clues short, concrete, and natural, but still vary the frame. Prefer one vivid everyday scene over a generic "You use/feel/do..." sentence.
- B1/B2: use more situational, indirect clues with realistic detail, but keep the answer uniquely defensible.
- In all levels, creativity must NEVER reduce clarity: the clue still needs concrete anchors that rule out every wrong option.

SELF-VERIFICATION BEFORE OUTPUT:
1. Counts: wrongAnswers and wrongAnswerExplanations have exactly ${wrongAnswerCount} items.
2. Language: descriptionLanguage matches description, and level language rule is satisfied.
3. No definition style: description is a real-life clue, not a dictionary definition.
4. No leakage: description does not contain correctAnswer, an inflection, a spelling variant, a near-synonym, the Vietnamese translation, or a near-translation.
5. Option-by-option uniqueness audit: for EACH wrongAnswer, ask "Could this word also fit the description as written?" If YES or MAYBE, rewrite the description or replace the wrongAnswer.
6. Context clarity: the description includes concrete anchors that rule out every wrong option without needing extra assumptions.
7. Topic/exclusion: topic lock and forbidden-word rules pass.
8. Clue-only: description contains no UI question line or direct answer instruction.
9. JSON: output is valid JSON only.

DIVERSITY ROTATION:
- Avoid overused quiz defaults like happy, sad, good, bad, big, small, make, do, get, thing.
- Rotate everyday domains: home, phone, school, work, food, travel, shopping, health, emotions, social plans.
- Rotate clue style and opening words. Do not make "You..." or "Bạn..." the default opening.
- Treat all examples as scaffolding, not output word banks or sentence templates.
- Do not copy the example output. It only demonstrates structure.

Example output (${wrongAnswerCount} wrong answers)${count > 1 ? ` — showing 1 of ${count} items in the "questions" array` : ''}:
${count > 1 ? `{ "questions": [` : ''}
{
  "description": "You are standing outside your door, checking every pocket before you can get in.",
  "descriptionLanguage": "en",
  "partOfSpeech": "noun",
  "correctAnswer": "key",
  "wrongAnswers": ${JSON.stringify(wrongAnswers, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "Key là thứ dùng để mở khóa, nên khớp trực tiếp với tình huống mở cửa nhà. Các lựa chọn còn lại có thể là đồ vật quen thuộc nhưng không có chức năng mở khóa.",
  "exampleSentence": "I left my key on the kitchen table this morning.",
  "exampleTranslation": "Sáng nay tôi để chìa khóa trên bàn bếp."
}${count > 1 ? `, ... (${count - 1} more) ] }` : ''}`;
}
