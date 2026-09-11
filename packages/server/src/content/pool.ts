/**
 * The question POOL (spec sections 1, 4, 22).
 *
 * FINAL Round 3 organizer bank: 32 authored questions (Q01-Q32), approved
 * across passes 1-3. Scope is C, Python, data structures in C (linked lists,
 * stacks & queues, graphs / BFS / DFS, trees, heap terminology), introductory
 * DBMS/SQL and limited Java/OOP. The bank is authored in two halves of 16:
 *
 *   Q01-Q16 : 14 normal + 2 premium (medium-leaning)
 *   Q17-Q32 : 12 normal + 4 premium (hard/very-hard-leaning)
 *
 * The default round shape (config.blocks=4 x questionsPerBlock=3) needs
 * EXACTLY 12 normal + 4 premium per game - which Q17-Q32 supplies exactly, with
 * nothing left over and nothing short. Q01-Q16 cannot fill a game on its own
 * (only 2 premiums against 4 required blocks) and would otherwise dilute the
 * draw with an uneven, medium-heavy mix. So Q17-Q32 is the ACTIVE pool fed to
 * every game; Q01-Q16 is kept as RESERVE_POOL (exported, not seeded) rather
 * than deleted, in case a future round wants it.
 *
 * QUESTION_POOL below is therefore the ACTIVE 16, not all 32 - see FULL_BANK
 * for every authored question (used for the organizer answer-key export).
 *
 * This is NOT the running order. The server draws a concrete sequence from this
 * pool at game start: three RANDOM normal questions, then a premium, repeated.
 * There is deliberately no difficulty ramp - any tier can appear anywhere.
 *
 * Every question carries its own domain, difficulty and (derived) solve time.
 * Solve times come from config by difficulty:
 *   easy 60s · medium 90s · hard 120s · very hard 150s
 * The approved bank uses only medium (90s), hard (120s) and very hard (150s).
 *
 * `evaluation` never reaches a participant: the server strips it.
 */

import { DEFAULT_DIFFICULTY_TIMES } from '@code-market/shared';
import type { Difficulty, Question, QuestionData, EvaluationData, Domain, ChallengeType } from '@code-market/shared';

interface Draft {
  id: string;
  kind: Question['kind'];
  title: string;
  domain: Domain;
  type: ChallengeType;
  difficulty: Difficulty;
  accessKey: string;
  question: QuestionData;
  evaluation: EvaluationData;
  timeLimit?: number;
  rewardOverride?: number;
  penaltyOverride?: number;
}

const draft = (d: Draft): Question => ({
  ...d,
  timeLimit: d.timeLimit ?? DEFAULT_DIFFICULTY_TIMES[d.difficulty],
});

/* ------------------------------------------------------------------ *
 * Accepted-answer helpers.
 *
 * Text answers are auto-graded after whitespace is collapsed and case is
 * ignored (see evaluation.ts). These helpers list the ways a team might
 * reasonably type a sequence / linked-list / literal so a correct answer is
 * not marked wrong over a comma-vs-arrow choice.
 * ------------------------------------------------------------------ */

/** Sequence / linked-list variants (arrow, ASCII arrow, space, comma). */
function nodeForms(nodes: (number | string)[], withNull: boolean): string[] {
  const s = nodes.map(String);
  const forms = [
    s.join(' → '),
    s.join(' -> '),
    s.join(' '),
    s.join(', '),
    s.join(','),
  ];
  if (withNull) {
    forms.push(`${s.join(' → ')} → NULL`, `${s.join(' -> ')} -> NULL`, `${s.join(' ')} NULL`);
  }
  return Array.from(new Set(forms));
}

/** Space-separated output that should also accept comma separators. */
function spacedForms(tokens: (number | string)[]): string[] {
  const s = tokens.map(String);
  return Array.from(new Set([s.join(' '), s.join(', '), s.join(',')]));
}

/** Literal output (Python repr). Accepts the canonical form, a
 *  whitespace-stripped form, and - for multi-line output - a single-line join. */
function literalForms(...lines: string[]): string[] {
  const tight = lines.map((l) => l.replace(/ /g, ''));
  const forms = new Set<string>();
  forms.add(lines.join('\n'));
  forms.add(tight.join('\n'));
  forms.add(lines.join(' '));
  forms.add(tight.join(''));
  forms.add(lines.join(''));
  return [...forms];
}

/* ==================================================================== *
 * NORMAL QUESTIONS (26)
 * ==================================================================== */

const NORMAL: Draft[] = [
  {
    id: 'Q01',
    kind: 'normal',
    title: 'C — Pointer Aliasing',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'medium',
    accessKey: 'Q-7413',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints.',
      code: `int a[] = {10, 20, 30, 40};
int *p = a + 1;
int *q = p;

*p = *q + 5;
q = &a[3];
*q = *p - 3;

printf("%d %d %d %d", a[0], a[1], a[2], a[3]);`,
      codeLanguage: 'c',
      placeholder: 'e.g. 10 20 30 40',
      hint: 'p and q start as aliases of a[1].',
    },
    evaluation: {
      acceptedAnswers: spacedForms([10, 25, 30, 22]),
      explanation:
        'p and q both point at a[1]. *p = *q + 5 makes a[1] = 25. q is repointed to a[3]; *q = *p - 3 = 25 - 3 = 22, so a[3] = 22. a[0] and a[2] are untouched.',
    },
  },
  {
    id: 'Q02',
    kind: 'normal',
    title: 'Python — Shared References',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'medium',
    accessKey: 'Q-2856',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints.',
      code: `x = [1, 2]
a = [x, x]
a[0].append(3)
a[1] = a[1] + [4]

print(a)`,
      codeLanguage: 'python',
      placeholder: 'e.g. [[...], [...]]',
      hint: 'a[0] and a[1] start as the SAME list object; rebinding a[1] breaks the alias.',
    },
    evaluation: {
      acceptedAnswers: literalForms('[[1, 2, 3], [1, 2, 4]]'),
      explanation:
        'a[0] and a[1] are the same object x, so append(3) makes x = [1,2,3] seen through both. a[1] = a[1] + [4] rebinds a[1] to a NEW list [1,2,3,4], leaving a[0] as [1,2,3].',
    },
  },
  {
    id: 'Q03',
    kind: 'normal',
    title: 'Stack — Expression',
    domain: 'dsa',
    type: 'numeric',
    difficulty: 'medium',
    accessKey: 'Q-3390',
    question: {
      prompt: 'Evaluate the postfix expression:  5 2 3 * + 4 -.  What single value remains on the stack after complete evaluation?',
      placeholder: 'a whole number',
    },
    evaluation: {
      correctNumber: 7,
      explanation: '3 * 2 = 6; 5 + 6 = 11; 11 - 4 = 7.',
    },
  },
  {
    id: 'Q04',
    kind: 'normal',
    title: 'Queue — Circular Index',
    domain: 'dsa',
    type: 'short_text',
    difficulty: 'medium',
    accessKey: 'Q-5127',
    question: {
      prompt:
        'A circular queue of capacity 5 contains 20, 30, 40 (front to rear). Dequeue twice, then enqueue 50 and 60. Give the final front-to-rear sequence.',
      placeholder: 'e.g. 10, 20, 30',
    },
    evaluation: {
      acceptedAnswers: nodeForms([40, 50, 60], false),
      explanation: 'Dequeue removes 20 then 30, leaving 40. Enqueue 50 and 60 gives front->rear 40, 50, 60.',
    },
  },
  {
    id: 'Q05',
    kind: 'normal',
    title: 'Linked List — Insert/Delete Trace',
    domain: 'dsa',
    type: 'short_text',
    difficulty: 'medium',
    accessKey: 'Q-6604',
    question: {
      prompt:
        'Start: 10 → 20 → 40 → 50 → NULL. Insert 30 after 20, then delete node 40. Give the final list.',
      placeholder: 'e.g. 10 -> 20 -> ... -> NULL',
    },
    evaluation: {
      acceptedAnswers: nodeForms([10, 20, 30, 50], true),
      explanation: 'Inserting 30 after 20 gives 10,20,30,40,50; deleting 40 gives 10 → 20 → 30 → 50 → NULL.',
    },
  },
  {
    id: 'Q07',
    kind: 'normal',
    title: 'Graphs — BFS',
    domain: 'algorithms',
    type: 'ordering',
    difficulty: 'medium',
    accessKey: 'Q-4471',
    question: {
      prompt:
        'Undirected graph: A:B,C; B:A,D,E; C:A,F; D:B; E:B,F; F:C,E. Starting at A and visiting neighbours in alphabetical order, arrange the nodes in BFS visiting order.',
      items: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
        { id: 'd', text: 'D' },
        { id: 'e', text: 'E' },
        { id: 'f', text: 'F' },
      ],
    },
    evaluation: {
      correctOrder: ['a', 'b', 'c', 'd', 'e', 'f'],
      explanation:
        'A enqueues B,C. B enqueues D,E. C enqueues F. Level order is A, then B,C, then D,E, then F: A B C D E F.',
    },
  },
  {
    id: 'Q08',
    kind: 'normal',
    title: 'Heap — Terminology',
    domain: 'dsa',
    type: 'mcq',
    difficulty: 'medium',
    accessKey: 'Q-1195',
    question: {
      prompt: 'In a MAX heap, which statement must be true?',
      options: [
        { id: 'a', text: 'Every leaf is smaller than every other node.' },
        { id: 'b', text: 'Every parent is >= its children.' },
        { id: 'c', text: 'The left child is always smaller than the right child.' },
        { id: 'd', text: 'The root is always the smallest element.' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'The max-heap property is only about parent vs. child: every parent is >= its children. Sibling order and leaf comparisons are not constrained, and the root is the LARGEST element.',
    },
  },
  {
    id: 'Q09',
    kind: 'normal',
    title: 'C — Recursion',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'hard',
    accessKey: 'Q-9037',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints.',
      code: `int f(int n) {
    if (n <= 1) return 1;
    return n + f(n-2);
}
printf("%d", f(7));`,
      codeLanguage: 'c',
      placeholder: 'a whole number',
      hint: 'The recursion steps down by 2 each time.',
    },
    evaluation: {
      acceptedAnswers: ['16'],
      explanation: 'f(7)=7+f(5)=7+5+f(3)=7+5+3+f(1)=7+5+3+1=16.',
    },
  },
  {
    id: 'Q10',
    kind: 'normal',
    title: 'C + Linked List — Pointer Rewiring',
    domain: 'dsa',
    type: 'short_text',
    difficulty: 'very_hard',
    accessKey: 'Q-2248',
    question: {
      prompt: 'Trace the pointer rewiring and give the resulting list.',
      code: `List: 10 → 20 → 30 → 40 → 50 → 60 → NULL.
p = head->next;          // 20
q = p->next->next;       // 40
p->next = q->next;       // 20 -> 50
q->next = p->next->next; // 40 -> 60
p->next->next = q;       // 50 -> 40`,
      placeholder: 'e.g. 10 -> 20 -> ... -> NULL',
    },
    evaluation: {
      acceptedAnswers: nodeForms([10, 20, 50, 40, 60], true),
      explanation:
        'p=20, q=40. p->next=q->next makes 20->50. q->next=p->next->next makes 40->60. p->next->next=q makes 50->40. 30 is dropped, giving 10 → 20 → 50 → 40 → 60 → NULL.',
    },
  },
  {
    id: 'Q11',
    kind: 'normal',
    title: 'C — Pointer Aliases',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'medium',
    accessKey: 'Q-7756',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints.',
      code: `int a[] = {5, 10, 15, 20};
int *p = &a[1];
int *q = p;

*p = *q + 5;
q = &a[3];
*q = *p - 3;

printf("%d %d %d %d", a[0], a[1], a[2], a[3]);`,
      codeLanguage: 'c',
      placeholder: 'e.g. 5 10 15 20',
      hint: 'p and q begin as aliases of a[1].',
    },
    evaluation: {
      acceptedAnswers: spacedForms([5, 15, 15, 12]),
      explanation:
        'p and q alias a[1]. *p = *q + 5 sets a[1] = 15. q moves to a[3]; *q = *p - 3 = 15 - 3 = 12, so a[3] = 12. a[0]=5 and a[2]=15 are unchanged.',
    },
  },
  {
    id: 'Q13',
    kind: 'normal',
    title: 'Linked List — Delete Without Head',
    domain: 'dsa',
    type: 'short_text',
    difficulty: 'hard',
    accessKey: 'Q-5580',
    question: {
      prompt:
        'List 10 → 20 → 30 → 40 → 50 → NULL. Given only a pointer p to node 30, perform p->data = p->next->data; p->next = p->next->next. Give the resulting list.',
      placeholder: 'e.g. 10 -> 20 -> ... -> NULL',
    },
    evaluation: {
      acceptedAnswers: nodeForms([10, 20, 40, 50], true),
      explanation:
        'Copying the next node’s data over node 30 turns it into 40, then unlinking the original 40 removes the duplicate: 10 → 20 → 40 → 50 → NULL.',
    },
  },
  {
    id: 'Q14',
    kind: 'normal',
    title: 'Linked List — Two Pointers',
    domain: 'dsa',
    type: 'mcq',
    difficulty: 'hard',
    accessKey: 'Q-6642',
    question: {
      prompt:
        'List 5 → 10 → 15 → 20 → 25 → 30 → 35 → NULL. With slow=head, fast=head, repeatedly do slow=slow->next; fast=fast->next->next until fast reaches the last node. Where is slow?',
      options: [
        { id: 'a', text: '10' },
        { id: 'b', text: '15' },
        { id: 'c', text: '20' },
        { id: 'd', text: '25' },
      ],
    },
    evaluation: {
      correctOptionIds: ['c'],
      explanation:
        'Fast advances two nodes per step: 5 → 15 → 25 → 35 (last), taking 3 steps. Slow advances one per step: 5 → 10 → 15 → 20. Slow lands on 20.',
    },
  },
  {
    id: 'Q15',
    kind: 'normal',
    title: 'Stack — Output Constraint',
    domain: 'dsa',
    type: 'multi',
    difficulty: 'hard',
    accessKey: 'Q-1207',
    question: {
      prompt:
        'Values 1,2,3,4,5 enter a stack in that order using only PUSH and POP. Select ALL sequences that are valid stack outputs.',
      options: [
        { id: 'a', text: '2, 1, 4, 3, 5' },
        { id: 'b', text: '3, 1, 2, 5, 4' },
        { id: 'c', text: '4, 3, 5, 1, 2' },
        { id: 'd', text: '2, 3, 1, 5, 4' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a', 'c', 'd'],
      explanation:
        'A, C and D can each be produced by an interleaving of pushes and pops. B (3,1,2,...) is impossible: once 3 is popped, 2 is on top and must come out before 1, so 1 cannot precede 2.',
    },
  },
  {
    id: 'Q16',
    kind: 'normal',
    title: 'Queue — Circular Queue State',
    domain: 'dsa',
    type: 'mcq',
    difficulty: 'hard',
    accessKey: 'Q-8834',
    question: {
      prompt:
        'A circular queue of capacity 6 initially contains 10,20,30,40. Dequeue twice; then enqueue 50,60,70. What is the final logical order front → rear?',
      options: [
        { id: 'a', text: '30, 40, 50, 60, 70' },
        { id: 'b', text: '50, 60, 70, 30, 40' },
        { id: 'c', text: '30, 40, 50, 60' },
        { id: 'd', text: '70, 60, 50, 40, 30' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a'],
      explanation:
        'Dequeue removes 10 and 20, leaving 30,40. Enqueue 50,60,70 appends at the rear. Logical front→rear order is 30, 40, 50, 60, 70.',
    },
  },
  {
    id: 'Q17',
    kind: 'normal',
    title: 'Tree — Recursive Code',
    domain: 'dsa',
    type: 'output',
    difficulty: 'hard',
    accessKey: 'Q-4093',
    question: {
      prompt: 'Trace mystery() on the tree and type EXACTLY what it prints (space-separated).',
      code: `        8
       / \\
      3   10
     / \\    \\
    1   6    14
       / \\   /
      4   7 13

mystery(node):
  if node is NULL: return
  mystery(node.left)
  if node has BOTH left and right: print(node)
  mystery(node.right)`,
      placeholder: 'e.g. 2 5',
      hint: 'It is an in-order walk that prints only nodes with two children.',
    },
    evaluation: {
      acceptedAnswers: spacedForms([3, 6, 8]),
      explanation:
        'In in-order order the nodes with both children are visited as 3 (children 1,6), then 6 (children 4,7), then 8 (children 3,10) once its entire left subtree - including the print of 6 - has completed. Output: 3 6 8.',
    },
  },
  {
    id: 'Q19',
    kind: 'normal',
    title: 'Graph — BFS vs DFS',
    domain: 'algorithms',
    type: 'multi',
    difficulty: 'very_hard',
    accessKey: 'Q-3372',
    question: {
      prompt:
        'Directed graph A→B,C; B→D; C→D,E; D→F; E→F; F→G, with alphabetical neighbour order. Select ALL statements that are TRUE.',
      options: [
        { id: 'a', text: 'BFS discovers D before E.' },
        { id: 'b', text: 'BFS discovers F at distance 3.' },
        { id: 'c', text: 'DFS necessarily visits E before D.' },
        { id: 'd', text: 'BFS discovers G at distance 4.' },
        { id: 'e', text: 'DFS can reach G through D before returning to C.' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a', 'b', 'd', 'e'],
      explanation:
        'BFS from A: A(0); B,C(1); D,E(2); F(3); G(4). So A, B and D hold. C is false - DFS from A goes A,B,D,F,G, reaching G via D before C is ever explored, which also makes E true.',
    },
  },
  {
    id: 'Q20',
    kind: 'normal',
    title: 'C — Array + Pointer + Function',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'very_hard',
    accessKey: 'Q-9915',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints.',
      code: `void change(int *p, int n) {
    for (int i = 0; i < n-1; i++)
        *(p+i) = *(p+i) + *(p+i+1);
}
int a[] = {1, 2, 3, 4};
change(a, 4);
printf("%d %d %d %d", a[0], a[1], a[2], a[3]);`,
      codeLanguage: 'c',
      placeholder: 'e.g. 1 2 3 4',
      hint: 'Each write uses the ALREADY-updated previous element.',
    },
    evaluation: {
      acceptedAnswers: spacedForms([3, 5, 7, 4]),
      explanation:
        'i=0: a[0]=1+2=3. i=1: a[1]=2+3=5. i=2: a[2]=3+4=7. a[3] is never written and stays 4. Result: 3 5 7 4.',
    },
  },
  {
    id: 'Q21',
    kind: 'normal',
    title: 'C — Pointer Chain Mutation',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'medium',
    accessKey: 'Q-2064',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints.',
      code: `int a[] = {4, 8, 12, 16, 20};
int *p = a + 1;
int *q = a + 3;

*p = *q;
q--;
*q = *p + 2;

printf("%d %d %d %d %d", a[0], a[1], a[2], a[3], a[4]);`,
      codeLanguage: 'c',
      placeholder: 'e.g. 4 8 12 16 20',
      hint: 'p points at a[1], q at a[3]; then q moves down one.',
    },
    evaluation: {
      acceptedAnswers: spacedForms([4, 16, 18, 16, 20]),
      explanation:
        '*p = *q sets a[1] = 16. q-- moves q to a[2]. *q = *p + 2 = 16 + 2 = 18, so a[2] = 18. a[0]=4, a[3]=16, a[4]=20 unchanged.',
    },
  },
  {
    id: 'Q22',
    kind: 'normal',
    title: 'Python — Aliasing + In-Place Mutation',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'hard',
    accessKey: 'Q-7728',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints (three lines).',
      code: `a = [1, 2, 3]
b = a
c = a[:]

b[1] = 8
c.append(4)

a = a + [5]
b.append(6)

print(a)
print(b)
print(c)`,
      codeLanguage: 'python',
      placeholder: 'one list per line',
      hint: 'b aliases a; c is a copy; a = a + [5] rebinds a to a new list.',
    },
    evaluation: {
      acceptedAnswers: literalForms('[1, 8, 3, 5]', '[1, 8, 3, 6]', '[1, 2, 3, 4]'),
      explanation:
        'b aliases a, so b[1]=8 makes both [1,8,3]; c is an independent copy that becomes [1,2,3,4]. a = a + [5] rebinds a to a NEW [1,8,3,5]; b still points at the old list and append(6) makes it [1,8,3,6].',
    },
  },
  {
    id: 'Q24',
    kind: 'normal',
    title: 'Stack — Minimum Information',
    domain: 'dsa',
    type: 'multi',
    difficulty: 'hard',
    accessKey: 'Q-6619',
    question: {
      prompt:
        'Operations on an empty stack: PUSH 5, PUSH 2, PUSH 8, POP, PUSH 3, POP, PUSH 7. Select ALL statements that are true afterwards.',
      options: [
        { id: 'a', text: 'The top element is 8.' },
        { id: 'b', text: 'The bottom element is 5.' },
        { id: 'c', text: 'There are exactly 3 elements.' },
        { id: 'd', text: '2 is directly above 5.' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b', 'c', 'd'],
      explanation:
        'Final stack bottom→top is 5, 2, 7 (8 and 3 were popped). The bottom is 5 (B), there are exactly 3 elements (C), and 2 sits directly above 5 (D) - all true. Only the top being 8 (A) is false; the top is actually 7.',
    },
  },
  {
    id: 'Q25',
    kind: 'normal',
    title: 'Queue + Stack — Transfer',
    domain: 'dsa',
    type: 'output',
    difficulty: 'hard',
    accessKey: 'Q-1183',
    question: {
      prompt:
        'Q = 10,20,30,40 (front to rear); S empty. Perform: PUSH(S, DEQUEUE(Q)); PUSH(S, DEQUEUE(Q)); ENQUEUE(Q, POP(S)); PUSH(S, DEQUEUE(Q)); then pop everything from S and print in pop order.',
      placeholder: 'e.g. 5 8',
      hint: 'Track S top-to-bottom as you go.',
    },
    evaluation: {
      acceptedAnswers: spacedForms([30, 10]),
      explanation:
        'DEQUEUE 10,20 pushed onto S (S: 10,20 bottom→top). POP gives 20, enqueued to Q (Q now 30,40,20). DEQUEUE 30 pushed onto S (S: 10,30). Popping S yields 30 then 10.',
    },
  },
  {
    id: 'Q26',
    kind: 'normal',
    title: 'Tree — Missing Relationship',
    domain: 'dsa',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'Q-8850',
    question: {
      prompt:
        'A binary tree has Preorder: M B A D C E T R Z and Inorder: A B C D E M R T Z. Which node is the RIGHT child of B?',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'C' },
        { id: 'c', text: 'D' },
        { id: 'd', text: 'E' },
      ],
    },
    evaluation: {
      correctOptionIds: ['c'],
      explanation:
        'M is the root. B is next in preorder; its subtree (inorder A B C D E) splits into A on the left and D, C, E on the right, so B’s right child is D. Within D’s own subtree (preorder D C E / inorder C D E), D’s children are C (left) and E (right) - but the question asks for B’s right child, which is D.',
    },
  },
  {
    id: 'Q28',
    kind: 'normal',
    title: 'Graph — BFS Queue Reasoning',
    domain: 'algorithms',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'Q-3345',
    question: {
      prompt:
        'Directed graph A→B,C; B→D,E; C→F; D→G; E→G; F→H; G→H. BFS from A with alphabetical neighbours. Immediately after processing B, what is in the queue (front → rear)?',
      options: [
        { id: 'a', text: 'C, D, E' },
        { id: 'b', text: 'D, E, C' },
        { id: 'c', text: 'C, E, D' },
        { id: 'd', text: 'D, C, E' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a'],
      explanation:
        'Start: enqueue A. Process A → enqueue B,C (queue: B,C). Process B → enqueue D,E at the rear (queue: C,D,E). So after B the queue front→rear is C, D, E.',
    },
  },
  {
    id: 'Q29',
    kind: 'normal',
    title: 'Graph — DFS Discovery vs Completion',
    domain: 'algorithms',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'Q-9971',
    question: {
      prompt:
        'Directed graph A→B,C; B→D; C→D,E; D→F; E→F. Recursive DFS from A with alphabetical neighbours. Which is the FINISH (completion) order?',
      options: [
        { id: 'a', text: 'F, D, B, E, C, A' },
        { id: 'b', text: 'B, D, F, C, E, A' },
        { id: 'c', text: 'F, D, E, C, B, A' },
        { id: 'd', text: 'D, F, B, E, C, A' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a'],
      explanation:
        'DFS A→B→D→F: F finishes, then D, then B. Back at A→C→(D already done)→E→F(done): E finishes, then C, then A. Finish order: F, D, B, E, C, A.',
    },
  },
  {
    id: 'Q30',
    kind: 'normal',
    title: 'Python — Dictionary + Aliasing',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'very_hard',
    accessKey: 'Q-2290',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints (two lines).',
      code: `a = {"x": [1, 2], "y": [3]}
b = a.copy()
b["x"].append(4)
b["y"] = b["y"] + [5]
print(a)
print(b)`,
      codeLanguage: 'python',
      placeholder: 'one dict per line',
      hint: 'dict.copy() is shallow: the lists are still shared until one is rebound.',
    },
    evaluation: {
      acceptedAnswers: literalForms("{'x': [1, 2, 4], 'y': [3]}", "{'x': [1, 2, 4], 'y': [3, 5]}"),
      explanation:
        'copy() is shallow, so a["x"] and b["x"] are the same list: append(4) shows in both. b["y"] = b["y"] + [5] rebinds only b’s "y" to a new list, so a["y"] stays [3] while b["y"] becomes [3,5].',
    },
  },
  {
    id: 'Q32',
    kind: 'normal',
    title: 'DBMS — SQL Grouping',
    domain: 'sql',
    type: 'mcq',
    difficulty: 'hard',
    accessKey: 'Q-5502',
    question: {
      prompt:
        'Table Marks(Student, Subject, Score): A-C-70, A-Python-90, B-C-80, B-Python-60, C-C-95. Which query returns students whose AVERAGE score is at least 80?',
      options: [
        { id: 'a', text: 'SELECT Student FROM Marks WHERE AVG(Score) >= 80 GROUP BY Student' },
        { id: 'b', text: 'SELECT Student FROM Marks GROUP BY Student HAVING AVG(Score) >= 80' },
        { id: 'c', text: 'SELECT Student FROM Marks HAVING AVG(Score) >= 80' },
        { id: 'd', text: 'SELECT Student FROM Marks WHERE Score >= 80' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'Aggregates cannot appear in WHERE, so A and C are invalid, and D filters individual rows, not averages. GROUP BY Student HAVING AVG(Score) >= 80 is the correct way to filter grouped aggregates.',
    },
  },
];

/* ==================================================================== *
 * PREMIUM QUESTIONS (6)
 * ==================================================================== */

const PREMIUM: Draft[] = [
  {
    id: 'Q06',
    kind: 'premium',
    title: 'Trees — Traversal',
    domain: 'dsa',
    type: 'ordering',
    difficulty: 'medium',
    accessKey: 'PRM-8802',
    question: {
      prompt:
        'PREMIUM. For the tree where A has children B and C, B has children D and E, and C has a right child F, arrange the nodes in PREORDER.',
      items: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
        { id: 'd', text: 'D' },
        { id: 'e', text: 'E' },
        { id: 'f', text: 'F' },
      ],
    },
    evaluation: {
      correctOrder: ['a', 'b', 'd', 'e', 'c', 'f'],
      explanation:
        'Preorder is node, then left subtree, then right subtree: A, (B, D, E), (C, F) = A B D E C F.',
    },
  },
  {
    id: 'Q12',
    kind: 'premium',
    title: 'Python — Nested List Aliasing',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'medium',
    accessKey: 'PRM-3319',
    question: {
      prompt: 'PREMIUM. Read the program and type EXACTLY what it prints.',
      code: `a = [[0] * 3] * 3
a[1][2] = 7
print(a)`,
      codeLanguage: 'python',
      placeholder: 'e.g. [[...], [...], [...]]',
      hint: '[x] * 3 repeats the SAME inner reference three times.',
    },
    evaluation: {
      acceptedAnswers: literalForms('[[0, 0, 7], [0, 0, 7], [0, 0, 7]]'),
      explanation:
        '[[0]*3]*3 makes three references to ONE inner list. a[1][2]=7 mutates that shared list, so all three rows show [0, 0, 7].',
    },
  },
  {
    id: 'Q18',
    kind: 'premium',
    title: 'Graph — BFS Distance',
    domain: 'algorithms',
    type: 'numeric',
    difficulty: 'hard',
    accessKey: 'PRM-5561',
    question: {
      prompt:
        'PREMIUM. Undirected edges: A-B, A-C, B-D, B-E, C-E, D-G, D-F, E-F. Run BFS from A. What is the minimum number of edges on a shortest path from A to G?',
      placeholder: 'a whole number',
    },
    evaluation: {
      correctNumber: 3,
      explanation: 'A→B (1) → D (2) → G (3). No shorter route exists, so the shortest path uses 3 edges.',
    },
  },
  {
    id: 'Q23',
    kind: 'premium',
    title: 'Linked List — Multiple Pointer Rewiring',
    domain: 'dsa',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'PRM-4407',
    question: {
      prompt: 'PREMIUM. Trace the pointer rewiring and choose the resulting list.',
      code: `Start: 10 → 20 → 30 → 40 → 50 → 60 → NULL.
p = head->next;          // 20
q = p->next->next;       // 40

p->next = q->next;
q->next = p->next->next;
p->next->next = q;`,
      options: [
        { id: 'a', text: '10 → 20 → 50 → 40 → 60 → NULL' },
        { id: 'b', text: '10 → 20 → 50 → 60 → NULL' },
        { id: 'c', text: '10 → 20 → 50 → 60 → 40 → NULL' },
        { id: 'd', text: '10 → 20 → 40 → 50 → 60 → NULL' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a'],
      explanation:
        'p=20, q=40. p->next=q->next → 20->50. q->next=p->next->next → 40->60. p->next->next=q → 50->40. Node 30 is dropped: 10 → 20 → 50 → 40 → 60 → NULL.',
    },
  },
  {
    id: 'Q27',
    kind: 'premium',
    title: 'Tree — Recursive Property',
    domain: 'dsa',
    type: 'numeric',
    difficulty: 'very_hard',
    accessKey: 'PRM-7724',
    question: {
      prompt:
        'PREMIUM. Tree: root 10 with children 5 and 15; 5 has children 2 and 7; 15 has children 12 and 20. mystery() returns the sum of all LEAF values. What does it return?',
      placeholder: 'a whole number',
    },
    evaluation: {
      correctNumber: 41,
      explanation: 'The leaves are 2, 7, 12 and 20. Their sum is 2 + 7 + 12 + 20 = 41.',
    },
  },
  {
    id: 'Q31',
    kind: 'premium',
    title: 'Java/OOP — Overriding + Constructor Order',
    domain: 'oop',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'PRM-1148',
    question: {
      prompt: 'PREMIUM. Read the program and choose EXACTLY what it prints.',
      code: `class A {
  A() { show(); }
  void show() { System.out.print("A "); }
}
class B extends A {
  int x = 10;
  B() { System.out.print(x + " "); }
  void show() { System.out.print(x + " "); }
}
new B();`,
      codeLanguage: 'java',
      options: [
        { id: 'a', text: 'A 10' },
        { id: 'b', text: '0 10' },
        { id: 'c', text: '10 10' },
        { id: 'd', text: 'A 0' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'A’s constructor calls the overridden show() (dynamic dispatch to B.show) BEFORE B’s field initialiser runs, so x is still 0 and it prints "0 ". Then B’s constructor runs after x=10, printing "10 ". Output: 0 10.',
    },
  },
];

/** Q-number parsed from an id like "Q17" -> 17, "PRM-.." style ids are not used here. */
const qNumber = (id: string): number => Number(id.slice(1));

/** The active half: Q17-Q32 (12 normal + 4 premium - exactly one game's worth). */
const isActive = (d: Draft): boolean => qNumber(d.id) >= 17;

/**
 * The pool actually seeded into every game: Q17-Q32 only (12 normal + 4
 * premium). See the file header for why the first half is excluded by design
 * rather than left to a random draw.
 */
export const QUESTION_POOL: Question[] = [...NORMAL, ...PREMIUM].filter(isActive).map(draft);

export const NORMAL_POOL = QUESTION_POOL.filter((q) => q.kind === 'normal');
export const PREMIUM_POOL = QUESTION_POOL.filter((q) => q.kind === 'premium');

/**
 * Q01-Q16, kept for reference / a possible future round. NOT included in
 * QUESTION_POOL and NOT fed to `engine.seedQuestions()` by default, so these
 * are never drawn into a live game.
 */
export const RESERVE_POOL: Question[] = [...NORMAL, ...PREMIUM].filter((d) => !isActive(d)).map(draft);

/** Every authored question, active + reserve (32) - for the organizer answer-key export. */
export const FULL_BANK: Question[] = [...NORMAL, ...PREMIUM].map(draft);

/** Pool composition, surfaced to the organizer so gaps are visible. */
export function poolSummary(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const q of QUESTION_POOL) {
    const key = `${q.kind}:${q.difficulty}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
