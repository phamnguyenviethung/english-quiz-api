# Question Generator Guideline

## 1. Purpose

Generate high-quality English reading questions from a single reading passage.

### Input

- `reading`
- `cefrLevel`
- `topic`
- Optional `quizType` or allowed quiz types

### Target

- One reading: **150–220 words**
- Generate **3 questions per reading**
- Questions must be answerable from the reading alone.
- Questions should test different information points.
- Questions should match the reading's CEFR level.
- Prefer natural comprehension over artificial difficulty.

---

## 2. Core Generation Principles

### 2.1 Evidence First

Every question must start from evidence in the passage.

```text
Question
→ Evidence in passage
→ Correct answer
```

If evidence is insufficient, do not generate that question.

### 2.2 One Defensible Correct Answer

Every question must have exactly **one best answer**.

The answer must be:

- explicitly stated;
- safely paraphrased; or
- logically inferred from sufficient evidence.

Never allow two options to be reasonably correct.

### 2.3 Question Independence

The 3 questions must be independently answerable.

- Q2 must not require Q1.
- Q3 must not require Q1 or Q2.
- One question must not reveal another answer.
- Avoid asking multiple questions about the same information point.

Prefer:

```text
Q1 → Information A
Q2 → Information B
Q3 → Information C
```

### 2.4 Question Diversity

When the passage supports different types, prefer **2–3 different quiz types**.

Do not force diversity when the passage does not naturally support it.

### 2.5 CEFR Difficulty

**A1:** detail, simple reason, sequence, result, basic vocabulary.

**A2:** detail, reason, result, sequence, vocabulary, simple main idea.

**B1:** detail, reason, cause-effect, sequence, main idea, vocabulary, inference, purpose.

**B2:** detail, main idea, purpose, cause-effect, inference, vocabulary, comparison, attitude, specific function, prediction.

Difficulty should come from reasoning demand, not unnecessarily difficult wording.

---

# 3. Standard Quiz Types

## `detail` — Explicit Information Retrieval

**Evidence:** one meaningful factual detail: person, place, time, object, action, or event.

**Method:**

1. Select a detail.
2. Convert it into Who/What/Where/When/How.
3. Paraphrase the passage.
4. Make the correct answer directly supported.
5. Use other passage details or changed attributes as distractors.

**Validation:** no inference; exactly one supported option.

---

## `main_idea` — Global Understanding

**Evidence:** central topic + central situation/development.

**Method:**

1. Understand the whole passage.
2. Identify the central idea.
3. Ignore minor details.
4. Ask: “What is the passage mainly about?”
5. Distractors should be too broad, too narrow, or minor details.

**Validation:** answer summarizes the whole passage, not one detail.

---

## `reason` — Action → Reason

**Evidence:** `Action / Decision → Reason`.

**Method:**

1. Find an action or decision.
2. Find its explicit reason.
3. Ask “Why did X...?”
4. Use other passage details as distractors.

**Validation:** reason must be text-supported; no speculation.

---

## `cause_effect` — Causal Relationship

**Evidence:** `Cause → Effect`.

**Method:**

1. Extract events.
2. Identify a real causal relationship.
3. Ask either “What caused X?” or “What happened because of X?”
4. Use unrelated/incorrect events as distractors.

**Validation:** do not confuse sequence with causation.

> A happened before B does not automatically mean A caused B.

---

## `sequence` — Temporal Ordering

**Evidence:** at least 3 clearly distinguishable events when possible.

**Method:**

1. Extract events.
2. Build the timeline.
3. Find temporal markers: first, then, after, before, later, finally.
4. Ask “What happened first/next/after X?”

**Validation:** order must be unambiguous.

---

## `inference` — Evidence-Based Inference

**Evidence:** preferably at least **2 supporting clues**.

**Method:**

1. Find clue A.
2. Find clue B.
3. Combine them.
4. Derive the smallest reasonable conclusion.
5. Ask what can be inferred/concluded.
6. Create distractors that are unsupported or contradicted.

**Validation:**

- No external knowledge.
- No speculative leap.
- Only one option is logically defensible.

> Infer, don't speculate.

---

## `vocabulary_context` — Contextual Meaning

**Evidence:** useful target word + sufficient context clues.

**Method:**

1. Select a CEFR-appropriate useful word.
2. Read its sentence and surrounding context.
3. Identify clues.
4. Determine the meaning in this context.
5. Ask “What does X most likely mean?”
6. Create plausible but contextually wrong meanings.

**Validation:** meaning must be recoverable without a dictionary.

---

## `purpose` — Intent / Purpose

**Evidence:** `Action → Goal / Intention`.

**Method:**

1. Identify the action/person/passage.
2. Identify the intended goal.
3. Ask “Why did X...?” or “What was X trying to achieve?”
4. Distractors should be related actions, consequences, or wrong intentions.

**Validation:** distinguish purpose from reason.

- Reason = why something happened.
- Purpose = what someone wanted to achieve.

---

## `result` — Outcome Identification

**Evidence:** `Situation → Problem → Action → Outcome`.

**Method:**

1. Identify the situation/problem.
2. Follow the actions.
3. Find the actual final outcome.
4. Ask “What happened in the end?” or “What did X eventually do?”
5. Use earlier actions or intended outcomes as distractors.

**Validation:** answer must be the actual outcome, not a plan.

---

## `true_false` — Statement Verification

**Evidence:** passage-supported statements.

**Method:**

1. Create statements from passage evidence.
2. Check each option against the passage.
3. Make one statement correct.
4. Make others false by changing person, time, place, action, quantity, or relationship.

**Validation:** “not mentioned” is not automatically false.

---

## `negative_detail` — NOT Mentioned / NOT True

**Evidence:** 3 supported options + 1 unsupported/contradicted option.

**Method:**

1. Create three options supported by the passage.
2. Create one option that is unsupported or contradicted.
3. Ask “Which is NOT mentioned?” or “Which is NOT true?”

**Validation:** exactly one unmatched/incorrect option.

---

## `matching` — Entity → Information Mapping

**Evidence:** multiple clearly distinguishable entities.

**Method:**

1. Extract entities.
2. Map each entity to an action/detail/property.
3. Ask which entity matches a given information point.
4. Use other entities as distractors.

**Validation:** only use when multiple entities exist.

---

## `best_title` — Central Idea → Title

**Evidence:** central idea + central situation.

**Method:**

1. Identify the main idea.
2. Identify the central event/topic.
3. Create the best concise title.
4. Create distractors that are too broad, too narrow, minor-detail focused, or inconsistent.

**Validation:** title must represent the whole passage.

---

## `paraphrase` — Meaning Preservation

**Evidence:** one important sentence.

**Method:**

1. Select a sentence.
2. Extract semantic components: subject, action, time, cause, condition, quantity, negation.
3. Rewrite using different wording.
4. Create distractors by changing one semantic component.

**Validation:** preserve meaning exactly, especially negation, tense, quantity, condition, and cause/effect.

---

## `reference` — Antecedent Resolution

**Evidence:** pronoun/reference with one clear antecedent.

**Method:**

1. Select a clear pronoun.
2. Find possible antecedents.
3. Check grammar and semantic compatibility.
4. Ask what the pronoun refers to.

**Validation:** do not use ambiguous references.

---

## `prediction` — Evidence-Based Future Prediction

**Evidence:** current situation + unresolved goal/problem + clear direction.

**Method:**

1. Identify current state.
2. Identify unresolved problem/goal.
3. Determine the likely direction.
4. Ask “What will most likely happen next?”
5. Create less-supported alternatives.

**Validation:** prediction must be evidence-based and probabilistic, not arbitrary.

---

## `attitude` — Evidence-Based Attitude

**Evidence:** words, actions, reactions, dialogue, and context.

**Method:**

1. Collect multiple clues when possible.
2. Infer the character/writer's attitude.
3. Ask “How did X feel about...?” or “What was X's attitude toward...?”
4. Use plausible but unsupported emotions as distractors.

**Validation:** do not infer attitude from one isolated clue.

---

## `specific_function` — Detail Function

**Evidence:** meaningful detail + surrounding context.

**Method:**

1. Select a detail with a clear role.
2. Read the context before and after it.
3. Identify its function:
   - introduce a problem;
   - explain a reason;
   - show a consequence;
   - provide evidence;
   - create contrast.
4. Ask why the writer mentions it.

**Validation:** detail must have a meaningful role.

---

## `comparison` — Attribute-Based Comparison

**Evidence:** two entities/events sharing a meaningful comparison dimension.

**Method:**

1. Identify Entity A.
2. Identify Entity B.
3. Find the same attribute for both.
4. Compare the two.
5. Ask how they are similar/different.

**Validation:** both sides must have sufficient textual evidence.

---

# 4. Question Selection Strategy

Do **not** randomly select 3 quiz types.

Use:

```text
Reading
→ Extract information points
→ Identify supported quiz types
→ Rank question opportunities
→ Select 3 complementary types
→ Generate
→ Validate
```

Rules:

1. Prefer strong textual evidence.
2. Prefer different information points.
3. Prefer 2–3 different quiz types.
4. Prefer easier types for A1/A2.
5. Allow reasoning types for B1/B2 when supported.
6. Never force an unsupported type.
7. Never use the same information point twice.
8. Do not sacrifice correctness for type diversity.

Example:

```text
Supported:
detail ✓
reason ✓
result ✓
vocabulary ✓
inference ✓
sequence ✗
comparison ✗
```

Good:

```text
detail + reason + vocabulary
```

or:

```text
detail + inference + result
```

Bad:

```text
sequence + comparison + prediction
```

if the passage does not support them.

---

# 5. Distractor Strategy

Distractors must be **plausible but definitely wrong**.

Good sources:

- another fact from the passage;
- correct fact + wrong person;
- correct fact + wrong time;
- correct fact + wrong location;
- partial truth;
- logical but unsupported interpretation;
- close paraphrase with one changed detail.

Avoid:

- obviously ridiculous options;
- unrelated information;
- much harder vocabulary;
- obviously different option lengths;
- multiple correct answers;
- ambiguous options.

---

# 6. Validation

Every question must pass:

### Evidence

- [ ] Correct answer is supported.
- [ ] Evidence can be located.
- [ ] No external knowledge is required.

### Correctness

- [ ] Exactly one correct answer.
- [ ] No second option is defensible.
- [ ] Answer matches the question.

### Quality

- [ ] Clear wording.
- [ ] No ambiguity.
- [ ] No duplicate with another question.
- [ ] Targets a meaningful information point.

### CEFR

- [ ] Vocabulary fits level.
- [ ] Sentence complexity fits level.
- [ ] Cognitive difficulty fits level.

### Distractors

- [ ] Plausible.
- [ ] Definitely wrong.
- [ ] Do not introduce ambiguity.
- [ ] Reasonably balanced in wording.

---

# 7. Recommended 3-Question Composition

These are preferences, not mandatory combinations.

### A1

```text
detail
+
reason / result
+
vocabulary_context
```

### A2

```text
detail
+
reason / sequence / result
+
vocabulary_context / main_idea
```

### B1

```text
detail
+
reason / cause_effect
+
inference / vocabulary_context / main_idea
```

### B2

```text
detail
+
inference / cause_effect / purpose
+
vocabulary_context / main_idea / attitude / specific_function
```

---

# 8. Output Contract

Return structured JSON only.

```json
{
  "questions": [
    {
      "quizType": "detail",
      "question": "Where did Anna meet her friend?",
      "options": ["At a café", "At a library", "At a station", "At her office"],
      "correctAnswer": 0
    }
  ]
}
```

Rules:

- Generate exactly **3 questions**.
- Each question must have a valid `quizType`.
- Each MCQ has exactly 4 options.
- Exactly one option is correct.
- `correctAnswer` references one option.
- No explanations unless explicitly requested.
- Do not output evidence fields unless required by the caller schema.

---

# 9. Core Principle

> **Analyze the passage first. Identify strong evidence and question opportunities. Select the best complementary quiz types. Generate each question from a specific evidence point. Then validate correctness, uniqueness, ambiguity, distractor quality, and CEFR suitability. Never create a question first and search for justification afterward.**
