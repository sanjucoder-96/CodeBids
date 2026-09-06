/**
 * The question POOL (spec sections 1, 4, 22).
 *
 * This is NOT the running order. The server draws a concrete sequence from this
 * pool at game start: three RANDOM normal questions, then a premium, repeated.
 * There is deliberately no difficulty ramp - any tier can appear anywhere.
 *
 * Every question carries its own domain, difficulty and (derived) solve time.
 * Solve times come from config by difficulty:
 *   easy 60s · medium 90s · hard 120s · very hard 150s
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

/* ==================================================================== *
 * NORMAL QUESTIONS
 * ==================================================================== */

const NORMAL: Draft[] = [
  /* ---------------------------------------------------------- EASY */
  {
    id: 'N01',
    kind: 'normal',
    title: 'Slice of Life',
    domain: 'output_prediction',
    type: 'output',
    difficulty: 'easy',
    accessKey: 'Q-4417',
    question: {
      prompt: 'Read the program and type EXACTLY what it prints.',
      code: `a = [1, 2, 3, 4, 5]
b = a[1:4]
b[0] = 99
print(a[1], b[0], len(b))`,
      codeLanguage: 'python',
      placeholder: 'e.g. 1 2 3',
      hint: 'Python slicing copies.',
    },
    evaluation: {
      acceptedAnswers: ['2 99 3'],
      explanation:
        'Slicing builds a NEW list, so mutating b never touches a. a[1] is still 2, b[0] is 99, and the slice has 3 elements.',
    },
  },
  {
    id: 'N02',
    kind: 'normal',
    title: 'Normal Form Notice',
    domain: 'databases',
    type: 'true_false',
    difficulty: 'easy',
    accessKey: 'Q-9925',
    question: {
      prompt:
        'TRUE or FALSE: A relation in BCNF is always in 3NF, but a relation in 3NF is not necessarily in BCNF.',
    },
    evaluation: {
      correctBoolean: true,
      explanation:
        'BCNF is strictly stronger than 3NF. Every BCNF relation satisfies 3NF; the reverse fails when a non-trivial dependency has a non-superkey determinant.',
    },
  },
  {
    id: 'N03',
    kind: 'normal',
    title: 'Big O Basics',
    domain: 'algorithms',
    type: 'mcq',
    difficulty: 'easy',
    accessKey: 'Q-2210',
    question: {
      prompt: 'What is the time complexity of searching a balanced binary search tree with n nodes?',
      options: [
        { id: 'a', text: 'O(1)' },
        { id: 'b', text: 'O(log n)' },
        { id: 'c', text: 'O(n)' },
        { id: 'd', text: 'O(n log n)' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation: 'A balanced BST has height O(log n), and search descends one level at a time.',
    },
  },
  {
    id: 'N04',
    kind: 'normal',
    title: 'Status Report',
    domain: 'networking',
    type: 'matching',
    difficulty: 'easy',
    accessKey: 'Q-3081',
    question: {
      prompt: 'Match each HTTP status code to its meaning.',
      left: [
        { id: 'c200', text: '200' },
        { id: 'c301', text: '301' },
        { id: 'c404', text: '404' },
        { id: 'c500', text: '500' },
      ],
      right: [
        { id: 'ok', text: 'OK' },
        { id: 'moved', text: 'Moved Permanently' },
        { id: 'missing', text: 'Not Found' },
        { id: 'server', text: 'Internal Server Error' },
      ],
    },
    evaluation: {
      correctPairs: { c200: 'ok', c301: 'moved', c404: 'missing', c500: 'server' },
      explanation: '2xx success, 3xx redirection, 4xx client error, 5xx server error.',
    },
  },
  {
    id: 'N05',
    kind: 'normal',
    title: 'Stack Discipline',
    domain: 'dsa',
    type: 'mcq',
    difficulty: 'easy',
    accessKey: 'Q-5540',
    question: {
      prompt: 'Push 1,2,3 onto a stack, pop once, push 4, then pop everything. What is the pop order?',
      options: [
        { id: 'a', text: '3, 4, 2, 1' },
        { id: 'b', text: '1, 2, 3, 4' },
        { id: 'c', text: '3, 2, 1, 4' },
        { id: 'd', text: '4, 2, 1' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a'],
      explanation:
        'Push 1,2,3 gives top=3. Pop yields 3. Push 4 gives top=4. Popping the rest yields 4, then 2, then 1.',
    },
  },
  {
    id: 'N06',
    kind: 'normal',
    title: 'Truthy Business',
    domain: 'output_prediction',
    type: 'output',
    difficulty: 'easy',
    accessKey: 'Q-6612',
    question: {
      prompt: 'What does this print?',
      code: `console.log([] + []);
console.log(typeof (1 / "a"));`,
      codeLanguage: 'javascript',
      placeholder: 'two lines',
      hint: 'The first line prints an empty string.',
    },
    evaluation: {
      acceptedAnswers: ['\nnumber', 'number'],
      ignoreWhitespace: true,
      explanation:
        '[] + [] coerces both arrays to "" and concatenates to an empty string. 1/"a" is NaN, whose typeof is "number".',
    },
  },

  /* -------------------------------------------------------- MEDIUM */
  {
    id: 'N07',
    kind: 'normal',
    title: 'Query Floor',
    domain: 'sql',
    type: 'mcq',
    difficulty: 'medium',
    accessKey: 'Q-2091',
    question: {
      prompt:
        'Table trades(id, team, amount). Which query returns ONLY teams whose TOTAL traded amount exceeds 1000?',
      code: `-- trades
--  1 | T01 |  600
--  2 | T01 |  500
--  3 | T02 |  900
--  4 | T03 | 1200`,
      codeLanguage: 'sql',
      options: [
        { id: 'a', text: 'SELECT team FROM trades WHERE SUM(amount) > 1000 GROUP BY team;' },
        { id: 'b', text: 'SELECT team FROM trades GROUP BY team HAVING SUM(amount) > 1000;' },
        { id: 'c', text: 'SELECT team FROM trades GROUP BY team WHERE SUM(amount) > 1000;' },
        { id: 'd', text: 'SELECT team, SUM(amount) FROM trades WHERE amount > 1000;' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'Aggregates are filtered with HAVING, after GROUP BY. WHERE runs before grouping and cannot reference SUM().',
    },
  },
  {
    id: 'N08',
    kind: 'normal',
    title: 'Deadlock Desk',
    domain: 'os',
    type: 'multi',
    difficulty: 'medium',
    accessKey: 'Q-7314',
    question: {
      prompt: 'Select ALL four Coffman conditions required for deadlock.',
      options: [
        { id: 'a', text: 'Mutual exclusion' },
        { id: 'b', text: 'Hold and wait' },
        { id: 'c', text: 'Preemption of held resources' },
        { id: 'd', text: 'No preemption' },
        { id: 'e', text: 'Circular wait' },
        { id: 'f', text: 'Priority inversion' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a', 'b', 'd', 'e'],
      explanation:
        'Mutual exclusion, hold and wait, no preemption, circular wait. Preemption BREAKS deadlock; priority inversion is unrelated.',
    },
  },
  {
    id: 'N09',
    kind: 'normal',
    title: 'Subnet Trading Floor',
    domain: 'networking',
    type: 'numeric',
    difficulty: 'medium',
    accessKey: 'Q-5508',
    question: {
      prompt:
        'The event LAN uses 192.168.10.0/26. How many USABLE host addresses does this subnet provide?',
      placeholder: 'a whole number',
      unit: 'hosts',
    },
    evaluation: {
      correctNumber: 62,
      tolerance: 0,
      explanation: 'A /26 leaves 6 host bits: 2^6 = 64, minus network and broadcast = 62 usable.',
    },
  },
  {
    id: 'N10',
    kind: 'normal',
    title: 'Complexity Exchange',
    domain: 'algorithms',
    type: 'mcq',
    difficulty: 'medium',
    accessKey: 'Q-8823',
    question: {
      prompt: 'What is the WORST-CASE time complexity of this function?',
      code: `int mystery(vector<int>& v, int target) {
    for (int i = 0; i < v.size(); i++) {
        int lo = 0, hi = v.size() - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (v[mid] == target - v[i]) return mid;
            if (v[mid] < target - v[i]) lo = mid + 1;
            else hi = mid - 1;
        }
    }
    return -1;
}`,
      codeLanguage: 'cpp',
      options: [
        { id: 'a', text: 'O(n)' },
        { id: 'b', text: 'O(n log n)' },
        { id: 'c', text: 'O(n^2)' },
        { id: 'd', text: 'O(log n)' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation: 'An O(log n) binary search inside an O(n) loop gives O(n log n).',
    },
  },
  {
    id: 'N11',
    kind: 'normal',
    title: 'Security Ledger',
    domain: 'security',
    type: 'matching',
    difficulty: 'medium',
    accessKey: 'Q-1287',
    question: {
      prompt: 'Match each attack to the defence that most directly prevents it.',
      left: [
        { id: 'sqli', text: 'SQL injection' },
        { id: 'xss', text: 'Stored XSS' },
        { id: 'csrf', text: 'CSRF' },
        { id: 'brute', text: 'Password brute force' },
      ],
      right: [
        { id: 'params', text: 'Parameterised queries' },
        { id: 'escape', text: 'Context-aware output encoding' },
        { id: 'token', text: 'Anti-forgery token / SameSite cookies' },
        { id: 'ratelimit', text: 'Rate limiting and account lockout' },
      ],
    },
    evaluation: {
      correctPairs: { sqli: 'params', xss: 'escape', csrf: 'token', brute: 'ratelimit' },
      explanation:
        'Bind parameters stop query injection, output encoding neutralises injected markup, anti-forgery tokens prove intent, rate limiting removes the guess budget.',
    },
  },
  {
    id: 'N12',
    kind: 'normal',
    title: 'Constructor Order',
    domain: 'oop',
    type: 'mcq',
    difficulty: 'medium',
    accessKey: 'Q-6673',
    question: {
      prompt: 'What does `new Derived()` print?',
      code: `class Base {
    Base() { print(); }
    void print() { System.out.println("Base"); }
}

class Derived extends Base {
    int x = 5;
    @Override void print() { System.out.println("Derived x=" + x); }
}`,
      codeLanguage: 'java',
      options: [
        { id: 'a', text: 'Base' },
        { id: 'b', text: 'Derived x=5' },
        { id: 'c', text: 'Derived x=0' },
        { id: 'd', text: 'A NullPointerException is thrown' },
      ],
    },
    evaluation: {
      correctOptionIds: ['c'],
      explanation:
        'The Base constructor runs before Derived field initialisers. Virtual dispatch already picks Derived.print(), but x still holds its default 0.',
    },
  },
  {
    id: 'N13',
    kind: 'normal',
    title: 'Index Economics',
    domain: 'databases',
    type: 'multi',
    difficulty: 'medium',
    accessKey: 'Q-4402',
    question: {
      prompt: 'Select ALL statements that are TRUE about database indexes.',
      options: [
        { id: 'a', text: 'They generally speed up SELECT queries that filter on the indexed column.' },
        { id: 'b', text: 'They generally slow down INSERT, UPDATE and DELETE.' },
        { id: 'c', text: 'They always reduce total storage used.' },
        { id: 'd', text: 'A composite index on (a, b) can serve a query filtering only on a.' },
        { id: 'e', text: 'A composite index on (a, b) can efficiently serve a query filtering only on b.' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a', 'b', 'd'],
      explanation:
        'Indexes trade write cost and storage for read speed. A composite index is usable left-to-right, so (a,b) helps a query on a but not one on b alone.',
    },
  },
  {
    id: 'N14',
    kind: 'normal',
    title: 'Closure Counter',
    domain: 'code_analysis',
    type: 'output',
    difficulty: 'medium',
    accessKey: 'Q-7788',
    question: {
      prompt: 'What is printed, on one line separated by single spaces?',
      code: `funcs = []
for i in range(3):
    funcs.append(lambda: i)
print(funcs[0](), funcs[1](), funcs[2]())`,
      codeLanguage: 'python',
      placeholder: 'e.g. 0 1 2',
      hint: 'Python closures capture the variable, not its value at creation time.',
    },
    evaluation: {
      acceptedAnswers: ['2 2 2'],
      explanation:
        'All three lambdas close over the same variable i, which is 2 after the loop finishes.',
    },
  },

  /* ---------------------------------------------------------- HARD */
  {
    id: 'N15',
    kind: 'normal',
    title: 'Order of Growth',
    domain: 'algorithms',
    type: 'ordering',
    difficulty: 'hard',
    accessKey: 'Q-6640',
    question: {
      prompt: 'Arrange these in ASCENDING order of WORST-CASE time complexity.',
      items: [
        { id: 'bsearch', text: 'Binary search on a sorted array' },
        { id: 'heapsort', text: 'Heapsort' },
        { id: 'quicksort', text: 'Quicksort (naive first-element pivot)' },
        { id: 'linear', text: 'Linear scan of an array' },
        { id: 'subsets', text: 'Enumerating every subset of n items' },
      ],
      hint: 'Worst case, not average case.',
    },
    evaluation: {
      correctOrder: ['bsearch', 'linear', 'heapsort', 'quicksort', 'subsets'],
      explanation:
        'O(log n) < O(n) < O(n log n) < O(n^2) naive quicksort worst case < O(2^n).',
    },
  },
  {
    id: 'N16',
    kind: 'normal',
    title: 'Lost Update',
    domain: 'code_analysis',
    type: 'mcq',
    difficulty: 'hard',
    accessKey: 'Q-3172',
    question: {
      prompt:
        'Two threads each run increment() 1000 times on the same Counter. Which statement is guaranteed TRUE?',
      code: `class Counter {
    private int value = 0;
    public void increment() { value = value + 1; }
    public int get() { return value; }
}`,
      codeLanguage: 'java',
      options: [
        { id: 'a', text: 'The final value is always exactly 2000.' },
        { id: 'b', text: 'The final value is at most 2000 and at least 2.' },
        { id: 'c', text: 'The final value is at least 1000.' },
        { id: 'd', text: 'A ConcurrentModificationException is thrown.' },
      ],
      hint: 'value = value + 1 is a read-modify-write, not atomic.',
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'Non-atomic read-modify-write loses updates. Maximum 2000; the theoretical minimum is 2 because each thread\'s last write must land. ConcurrentModificationException applies to collections.',
    },
  },
  {
    id: 'N17',
    kind: 'normal',
    title: 'Two Structures',
    domain: 'dsa',
    type: 'output',
    difficulty: 'hard',
    accessKey: 'Q-8804',
    question: {
      prompt: 'Trace the program and type the EXACT output (one line, single spaces).',
      code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    stack<int> s;
    queue<int> q;
    for (int i = 1; i <= 5; i++) {
        if (i % 2) s.push(i);
        else q.push(i);
    }
    while (!s.empty() && !q.empty()) {
        cout << s.top() + q.front() << " ";
        s.pop();
        q.pop();
    }
    cout << s.top();
    return 0;
}`,
      codeLanguage: 'cpp',
      placeholder: 'e.g. 4 6 2',
      hint: 'Stack is LIFO, queue is FIFO. Note the trailing element.',
    },
    evaluation: {
      acceptedAnswers: ['7 7 1'],
      explanation:
        'Stack holds 1,3,5 (top 5); queue holds 2,4 (front 2). 5+2=7, then 3+4=7. The queue empties, so s.top() prints the remaining 1.',
    },
  },
  {
    id: 'N18',
    kind: 'normal',
    title: 'Isolation Levels',
    domain: 'databases',
    type: 'mcq',
    difficulty: 'hard',
    accessKey: 'Q-9014',
    question: {
      prompt:
        'Which anomaly is PREVENTED by REPEATABLE READ but still permitted by READ COMMITTED?',
      options: [
        { id: 'a', text: 'Dirty read' },
        { id: 'b', text: 'Non-repeatable read' },
        { id: 'c', text: 'Phantom read' },
        { id: 'd', text: 'Lost update on a single row write' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'READ COMMITTED already blocks dirty reads but allows a row to change between two reads. REPEATABLE READ prevents that; phantoms may still occur (in the standard) until SERIALIZABLE.',
    },
  },
  {
    id: 'N19',
    kind: 'normal',
    title: 'Page Fault Ledger',
    domain: 'os',
    type: 'numeric',
    difficulty: 'hard',
    accessKey: 'Q-1150',
    question: {
      prompt:
        'A system uses FIFO page replacement with THREE frames. For the reference string 1 2 3 4 1 2 5 1 2 3 4 5, how many page faults occur (count the initial loads)?',
      placeholder: 'a whole number',
      unit: 'faults',
      hint: 'This is the classic Belady sequence.',
    },
    evaluation: {
      correctNumber: 9,
      tolerance: 0,
      explanation:
        'FIFO with 3 frames faults 9 times on this string. (With 4 frames it faults 10 - the Belady anomaly.)',
    },
  },
  {
    id: 'N20',
    kind: 'normal',
    title: 'Prototype Chain',
    domain: 'oop',
    type: 'output',
    difficulty: 'hard',
    accessKey: 'Q-2277',
    question: {
      prompt: 'What is printed, one value per line?',
      code: `function A() {}
A.prototype.hello = function () { return "A"; };

function B() {}
B.prototype = Object.create(A.prototype);

const b = new B();
console.log(b.hello());
B.prototype.hello = function () { return "B"; };
console.log(b.hello());`,
      codeLanguage: 'javascript',
      placeholder: 'two lines',
    },
    evaluation: {
      acceptedAnswers: ['A\nB'],
      ignoreWhitespace: true,
      explanation:
        'Lookup walks the prototype chain at call time. Initially only A.prototype has hello; adding it to B.prototype shadows A for later calls.',
    },
  },

  /* ----------------------------------------------------- VERY HARD */
  {
    id: 'N21',
    kind: 'normal',
    title: 'Maximum Profit',
    domain: 'optimization',
    type: 'numeric',
    difficulty: 'very_hard',
    accessKey: 'Q-1212',
    question: {
      prompt:
        'A trader may hold at most ONE share at a time and must sell before buying again. Given the daily prices below, what is the MAXIMUM total profit across any number of transactions?',
      code: `prices = [7, 1, 5, 3, 6, 4, 9, 2]`,
      codeLanguage: 'python',
      placeholder: 'maximum total profit',
      unit: 'profit',
      hint: 'Unlimited transactions: capture every upward move.',
    },
    evaluation: {
      correctNumber: 12,
      tolerance: 0,
      explanation: 'Sum every positive consecutive difference: (5-1)+(6-3)+(9-4) = 4+3+5 = 12.',
    },
  },
  {
    id: 'N22',
    kind: 'normal',
    title: 'Amortised Truth',
    domain: 'dsa',
    type: 'multi',
    difficulty: 'very_hard',
    accessKey: 'Q-3390',
    question: {
      prompt: 'Select ALL statements that are TRUE.',
      options: [
        { id: 'a', text: 'Appending to a dynamic array that doubles is O(1) amortised.' },
        { id: 'b', text: 'A single append to a dynamic array is always O(1).' },
        { id: 'c', text: 'Union-Find with path compression and union by rank is near-constant amortised.' },
        { id: 'd', text: 'Hash table lookup is O(1) worst case.' },
        { id: 'e', text: 'Building a binary heap from n items can be done in O(n).' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a', 'c', 'e'],
      explanation:
        'Doubling gives O(1) amortised but a resize is O(n). Union-Find is O(alpha(n)). Heapify is O(n). Hash lookup degrades to O(n) with adversarial collisions.',
    },
  },
  {
    id: 'N23',
    kind: 'normal',
    title: 'Deadlock or Not',
    domain: 'os',
    type: 'true_false',
    difficulty: 'very_hard',
    accessKey: 'Q-4455',
    question: {
      prompt:
        'TRUE or FALSE: If every process requests all of its resources at once before executing, deadlock is impossible.',
      hint: 'Which Coffman condition does this remove?',
    },
    evaluation: {
      correctBoolean: true,
      explanation:
        'Requesting everything up front eliminates hold-and-wait. Removing any one of the four Coffman conditions makes deadlock impossible (though this approach hurts utilisation and can starve).',
    },
  },
  {
    id: 'N24',
    kind: 'normal',
    title: 'Window Query',
    domain: 'sql',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'Q-5566',
    question: {
      prompt:
        'Table scores(team, round, points). Which query returns each team\'s row for its HIGHEST-scoring round, ties broken by the lowest round number?',
      codeLanguage: 'sql',
      options: [
        {
          id: 'a',
          text: 'SELECT team, round, points FROM scores GROUP BY team HAVING points = MAX(points);',
        },
        {
          id: 'b',
          text: 'SELECT team, round, points FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY team ORDER BY points DESC, round ASC) rn FROM scores) t WHERE rn = 1;',
        },
        {
          id: 'c',
          text: 'SELECT team, MAX(points), round FROM scores GROUP BY team;',
        },
        {
          id: 'd',
          text: 'SELECT DISTINCT team, MAX(points) OVER (PARTITION BY team) FROM scores;',
        },
      ],
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'ROW_NUMBER() partitioned by team, ordered by points desc then round asc, picks exactly one deterministic row per team. The GROUP BY forms select a non-aggregated round column, which is wrong (or rejected) in standard SQL.',
    },
  },
  {
    id: 'N25',
    kind: 'normal',
    title: 'Byzantine Bits',
    domain: 'cs_concepts',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'Q-6677',
    question: {
      prompt:
        'By the CAP theorem, a distributed system that continues to answer every request during a network partition must give up which guarantee?',
      options: [
        { id: 'a', text: 'Consistency' },
        { id: 'b', text: 'Availability' },
        { id: 'c', text: 'Partition tolerance' },
        { id: 'd', text: 'Durability' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a'],
      explanation:
        'During a partition a system must choose. Answering every request keeps availability, so linearizable consistency must be sacrificed. Durability is not part of CAP.',
    },
  },
  {
    id: 'N26',
    kind: 'normal',
    title: 'Recursion Depth',
    domain: 'logic',
    type: 'numeric',
    difficulty: 'very_hard',
    accessKey: 'Q-7702',
    question: {
      prompt: 'What value does f(6) return?',
      code: `def f(n):
    if n <= 1:
        return 1
    return f(n - 1) + 2 * f(n - 2)`,
      codeLanguage: 'python',
      placeholder: 'a whole number',
    },
    evaluation: {
      correctNumber: 43,
      tolerance: 0,
      explanation:
        'f(0)=1, f(1)=1, f(2)=1+2=3, f(3)=3+2=5, f(4)=5+6=11, f(5)=11+10=21, f(6)=21+22=43.',
    },
  },
];

/* ==================================================================== *
 * PREMIUM QUESTIONS
 * ==================================================================== */

const PREMIUM: Draft[] = [
  {
    id: 'P1',
    kind: 'premium',
    title: 'Algorithms Vault',
    domain: 'algorithms',
    type: 'ordering',
    difficulty: 'hard',
    accessKey: 'PRM-6640',
    question: {
      prompt:
        'PREMIUM. Arrange these algorithms in ASCENDING order of their worst-case time complexity.',
      items: [
        { id: 'counting', text: 'Counting sort (k = O(n))' },
        { id: 'merge', text: 'Merge sort' },
        { id: 'bubble', text: 'Bubble sort' },
        { id: 'floyd', text: 'Floyd-Warshall all-pairs shortest paths' },
        { id: 'tsp', text: 'Held-Karp travelling salesman' },
      ],
      hint: 'Worst case only.',
    },
    evaluation: {
      correctOrder: ['counting', 'merge', 'bubble', 'floyd', 'tsp'],
      explanation:
        'O(n) counting sort < O(n log n) merge sort < O(n^2) bubble sort < O(n^3) Floyd-Warshall < O(n^2 · 2^n) Held-Karp.',
    },
  },
  {
    id: 'P2',
    kind: 'premium',
    title: 'Concurrency Vault',
    domain: 'os',
    type: 'multi',
    difficulty: 'very_hard',
    accessKey: 'PRM-3172',
    question: {
      prompt: 'PREMIUM. Select ALL statements that are TRUE about mutexes and semaphores.',
      options: [
        { id: 'a', text: 'A binary semaphore and a mutex are interchangeable in every situation.' },
        { id: 'b', text: 'A mutex has an owner; only the locking thread should unlock it.' },
        { id: 'c', text: 'A counting semaphore can allow N threads into a section simultaneously.' },
        { id: 'd', text: 'Spinlocks are preferable to blocking locks for long critical sections.' },
        { id: 'e', text: 'Priority inheritance mitigates priority inversion.' },
      ],
    },
    evaluation: {
      correctOptionIds: ['b', 'c', 'e'],
      explanation:
        'Mutexes have ownership; semaphores do not, so they are not interchangeable. Counting semaphores admit N holders. Spinlocks burn CPU and suit only very short sections. Priority inheritance is the standard inversion fix.',
    },
  },
  {
    id: 'P3',
    kind: 'premium',
    title: 'Databases Vault',
    domain: 'databases',
    type: 'output',
    difficulty: 'very_hard',
    accessKey: 'PRM-8804',
    question: {
      prompt:
        'PREMIUM. Given the table below, type the EXACT result of the query as a single line of comma-separated values.',
      code: `-- t(id, val)
--  1 | 10
--  2 | NULL
--  3 | 30
--  4 | NULL
--  5 | 50

SELECT COUNT(*), COUNT(val), SUM(val), AVG(val) FROM t;`,
      codeLanguage: 'sql',
      placeholder: 'e.g. 5,3,90,30',
      hint: 'COUNT(*) counts rows; COUNT(col) skips NULLs, and so does AVG.',
    },
    evaluation: {
      acceptedAnswers: ['5,3,90,30', '5, 3, 90, 30'],
      explanation:
        'COUNT(*)=5 rows. COUNT(val)=3 non-null. SUM=10+30+50=90. AVG ignores NULLs: 90/3=30, not 90/5.',
    },
  },
  {
    id: 'P4',
    kind: 'premium',
    title: 'The Final Vault',
    domain: 'optimization',
    type: 'numeric',
    difficulty: 'very_hard',
    accessKey: 'PRM-1212',
    question: {
      prompt:
        'FINAL PREMIUM. A 0/1 knapsack has capacity 10. Items are (weight, value): (5,10) (4,40) (6,30) (3,50). What is the maximum total value?',
      placeholder: 'maximum value',
      unit: 'value',
      hint: 'Each item may be taken at most once.',
    },
    evaluation: {
      correctNumber: 90,
      tolerance: 0,
      explanation:
        'Take (3,50) and (4,40): weight 7 <= 10, value 90. Adding (5,10) would exceed capacity. No combination beats 90.',
    },
  },
  {
    id: 'P5',
    kind: 'premium',
    title: 'Networking Vault',
    domain: 'networking',
    type: 'mcq',
    difficulty: 'very_hard',
    accessKey: 'PRM-4419',
    question: {
      prompt:
        'PREMIUM. A TCP connection has a 64 KB receive window over a link with 200 ms round-trip time. Ignoring loss, what is the approximate maximum throughput?',
      options: [
        { id: 'a', text: 'about 2.6 Mbit/s' },
        { id: 'b', text: 'about 320 kbit/s' },
        { id: 'c', text: 'about 26 Mbit/s' },
        { id: 'd', text: 'It is unbounded once slow start finishes.' },
      ],
      hint: 'Throughput is bounded by window / RTT.',
    },
    evaluation: {
      correctOptionIds: ['a'],
      explanation:
        '65536 bytes / 0.2 s = 327680 bytes/s, which is about 2.6 Mbit/s. The window, not the link, is the bottleneck.',
    },
  },
  {
    id: 'P6',
    kind: 'premium',
    title: 'Security Vault',
    domain: 'security',
    type: 'multi',
    difficulty: 'hard',
    accessKey: 'PRM-5523',
    question: {
      prompt: 'PREMIUM. Select ALL statements that are TRUE about password storage.',
      options: [
        { id: 'a', text: 'A per-user salt prevents precomputed rainbow-table attacks.' },
        { id: 'b', text: 'SHA-256 alone is a suitable password hash because it is cryptographically secure.' },
        { id: 'c', text: 'bcrypt, scrypt and Argon2 are deliberately slow.' },
        { id: 'd', text: 'A pepper is stored alongside the hash in the same database column.' },
        { id: 'e', text: 'Increasing the work factor over time is good practice.' },
      ],
    },
    evaluation: {
      correctOptionIds: ['a', 'c', 'e'],
      explanation:
        'Salts defeat precomputation. Fast hashes like SHA-256 are unsuitable precisely because they are fast. A pepper must live OUTSIDE the database, otherwise it adds nothing.',
    },
  },
];

export const QUESTION_POOL: Question[] = [...NORMAL, ...PREMIUM].map(draft);

export const NORMAL_POOL = QUESTION_POOL.filter((q) => q.kind === 'normal');
export const PREMIUM_POOL = QUESTION_POOL.filter((q) => q.kind === 'premium');

/** Pool composition, surfaced to the organizer so gaps are visible. */
export function poolSummary(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const q of QUESTION_POOL) {
    const key = `${q.kind}:${q.difficulty}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
