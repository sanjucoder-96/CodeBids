/**
 * The fixed Round 2 question pool (spec sections 5 and 6).
 *
 * Sequence is fixed and must not change:
 *   01 M  02 M  03 M  04 P  05 M  06 M  07 P  08 M  09 M  10 P  11 M  12 FINAL P
 *
 * There are deliberately NO extra questions for failed premiums, reclaims or
 * ties - a reclaim re-uses the SAME premium question.
 *
 * Question types are deliberately varied (MCQ, multi-select, output prediction,
 * ordering, matching, SQL, numeric, true/false, code analysis) so the round does
 * not degenerate into a debugging-only quiz.
 *
 * `evaluation` never reaches a participant client: the server strips it.
 */

import type { Challenge } from '@code-market/shared';

export const CHALLENGE_POOL: Challenge[] = [
  /* ---------------------------------------------------------------- 01 */
  {
    id: 'C01',
    index: 1,
    title: 'Opening Bell',
    category: 'output_prediction',
    type: 'output',
    difficulty: 'easy',
    marketType: 'market',
    timeLimit: 90,
    accessKey: 'MKT-4417',
    question: {
      prompt:
        'The market opens. Read the program carefully and type EXACTLY what it prints to standard output.',
      code: `a = [1, 2, 3, 4, 5]
b = a[1:4]
b[0] = 99
print(a[1], b[0], len(b))`,
      codeLanguage: 'python',
      placeholder: 'e.g. 1 2 3',
      hint: 'Python list slicing copies. Mind the spacing produced by print.',
    },
    evaluation: {
      acceptedAnswers: ['2 99 3'],
      explanation:
        'Slicing builds a NEW list, so mutating b never touches a. a[1] is still 2, b[0] is 99, and the slice a[1:4] has 3 elements.',
    },
  },

  /* ---------------------------------------------------------------- 02 */
  {
    id: 'C02',
    index: 2,
    title: 'Complexity Exchange',
    category: 'algorithms',
    type: 'mcq',
    difficulty: 'easy',
    marketType: 'market',
    timeLimit: 75,
    accessKey: 'MKT-8823',
    question: {
      prompt: 'What is the WORST-CASE time complexity of the function below?',
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
      explanation:
        'An O(log n) binary search runs inside an O(n) loop, giving O(n log n) in the worst case.',
    },
  },

  /* ---------------------------------------------------------------- 03 */
  {
    id: 'C03',
    index: 3,
    title: 'Query Floor',
    category: 'sql',
    type: 'mcq',
    difficulty: 'medium',
    marketType: 'market',
    timeLimit: 100,
    accessKey: 'MKT-2091',
    question: {
      prompt:
        'Table trades(id, team, amount). Which query returns ONLY the teams whose TOTAL traded amount is strictly greater than 1000?',
      code: `-- trades
-- id | team | amount
--  1 | T01  |  600
--  2 | T01  |  500
--  3 | T02  |  900
--  4 | T03  | 1200`,
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
        'Aggregates are filtered with HAVING, after GROUP BY. WHERE is evaluated before grouping and cannot reference SUM().',
    },
  },

  /* ---------------------------------------------------------------- 04  PREMIUM */
  {
    id: 'C04',
    index: 4,
    title: 'Algorithms Vault',
    category: 'algorithms',
    type: 'ordering',
    difficulty: 'hard',
    marketType: 'premium',
    timeLimit: 180,
    accessKey: 'PRM-6640',
    question: {
      prompt:
        'PREMIUM. Arrange these algorithms in ASCENDING order of their worst-case time complexity. Ties are impossible - every entry has a distinct worst case.',
      items: [
        { id: 'bsearch', text: 'Binary search on a sorted array' },
        { id: 'heapsort', text: 'Heapsort' },
        { id: 'quicksort', text: 'Quicksort (naive first-element pivot)' },
        { id: 'linear', text: 'Linear scan of an array' },
        { id: 'subsets', text: 'Enumerating every subset of n items' },
      ],
      hint: 'Worst case, not average case. The naive pivot matters.',
    },
    evaluation: {
      correctOrder: ['bsearch', 'linear', 'heapsort', 'quicksort', 'subsets'],
      explanation:
        'O(log n) binary search < O(n) linear scan < O(n log n) heapsort < O(n^2) naive quicksort worst case < O(2^n) subset enumeration.',
    },
  },

  /* ---------------------------------------------------------------- 05 */
  {
    id: 'C05',
    index: 5,
    title: 'Deadlock Desk',
    category: 'os',
    type: 'multi',
    difficulty: 'medium',
    marketType: 'market',
    timeLimit: 90,
    accessKey: 'MKT-7314',
    question: {
      prompt:
        'Select ALL of the four Coffman conditions that must hold simultaneously for a deadlock to be possible.',
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
        'The four Coffman conditions are mutual exclusion, hold and wait, no preemption and circular wait. Preemption actually BREAKS deadlock; priority inversion is a different problem.',
    },
  },

  /* ---------------------------------------------------------------- 06 */
  {
    id: 'C06',
    index: 6,
    title: 'Subnet Trading Floor',
    category: 'networking',
    type: 'numeric',
    difficulty: 'medium',
    marketType: 'market',
    timeLimit: 100,
    accessKey: 'MKT-5508',
    question: {
      prompt:
        'The event LAN uses 192.168.10.0/26. How many USABLE host addresses does this subnet provide (excluding network and broadcast addresses)?',
      placeholder: 'a whole number',
      unit: 'hosts',
    },
    evaluation: {
      correctNumber: 62,
      tolerance: 0,
      explanation:
        'A /26 leaves 6 host bits: 2^6 = 64 addresses, minus the network and broadcast address = 62 usable hosts.',
    },
  },

  /* ---------------------------------------------------------------- 07  PREMIUM */
  {
    id: 'C07',
    index: 7,
    title: 'Concurrency Vault',
    category: 'code_analysis',
    type: 'mcq',
    difficulty: 'hard',
    marketType: 'premium',
    timeLimit: 180,
    accessKey: 'PRM-3172',
    question: {
      prompt:
        'PREMIUM. Two threads run increment() 1000 times each on the same Counter instance. Which statement is guaranteed TRUE?',
      code: `class Counter {
    private int value = 0;

    public void increment() {
        value = value + 1;
    }

    public int get() {
        return value;
    }
}`,
      codeLanguage: 'java',
      options: [
        { id: 'a', text: 'The final value is always exactly 2000.' },
        { id: 'b', text: 'The final value is at most 2000 and at least 2.' },
        { id: 'c', text: 'The final value is at least 1000.' },
        { id: 'd', text: 'The code will throw a ConcurrentModificationException.' },
      ],
      hint: 'value = value + 1 is a read-modify-write, not an atomic operation.',
    },
    evaluation: {
      correctOptionIds: ['b'],
      explanation:
        'The increment is a non-atomic read-modify-write, so updates can be lost. The maximum is 2000 (no updates lost) and the theoretical minimum is 2 - every interleaved write can clobber another, but the last write of each thread must land. ConcurrentModificationException applies to collections, not to an int field.',
    },
  },

  /* ---------------------------------------------------------------- 08 */
  {
    id: 'C08',
    index: 8,
    title: 'Normal Form Notice',
    category: 'dbms',
    type: 'true_false',
    difficulty: 'easy',
    marketType: 'market',
    timeLimit: 60,
    accessKey: 'MKT-9925',
    question: {
      prompt:
        'TRUE or FALSE: A relation in BCNF is always in 3NF, but a relation in 3NF is not necessarily in BCNF.',
    },
    evaluation: {
      correctBoolean: true,
      explanation:
        'BCNF is strictly stronger than 3NF. Every BCNF relation satisfies 3NF; the reverse fails when a non-trivial dependency has a non-superkey determinant that is part of a candidate key.',
    },
  },

  /* ---------------------------------------------------------------- 09 */
  {
    id: 'C09',
    index: 9,
    title: 'Security Ledger',
    category: 'security',
    type: 'matching',
    difficulty: 'medium',
    marketType: 'market',
    timeLimit: 110,
    accessKey: 'MKT-1287',
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
        'Each defence targets the mechanism of its attack: bind parameters stop query injection, output encoding neutralises injected markup, anti-forgery tokens prove intent, and rate limiting removes the attacker guess budget.',
    },
  },

  /* ---------------------------------------------------------------- 10  PREMIUM */
  {
    id: 'C10',
    index: 10,
    title: 'Data Structure Vault',
    category: 'dsa',
    type: 'output',
    difficulty: 'hard',
    marketType: 'premium',
    timeLimit: 180,
    accessKey: 'PRM-8804',
    question: {
      prompt:
        'PREMIUM. Trace the program and type the EXACT output (a single line, values separated by single spaces).',
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
      hint: 'Stack is LIFO, queue is FIFO. Note the trailing element printed after the loop.',
    },
    evaluation: {
      acceptedAnswers: ['7 7 1'],
      explanation:
        'The stack holds 1,3,5 with top=5; the queue holds 2,4 with front=2. Pass 1 prints 5+2=7. Pass 2 prints 3+4=7. The queue is now empty so the loop stops, and s.top() prints the remaining 1. Output: 7 7 1',
    },
  },

  /* ---------------------------------------------------------------- 11 */
  {
    id: 'C11',
    index: 11,
    title: 'Last Market',
    category: 'oop',
    type: 'mcq',
    difficulty: 'medium',
    marketType: 'market',
    timeLimit: 90,
    accessKey: 'MKT-6673',
    question: {
      prompt: 'What does this program print?',
      code: `class Base {
    Base() { print(); }
    void print() { System.out.println("Base"); }
}

class Derived extends Base {
    int x = 5;
    @Override void print() { System.out.println("Derived x=" + x); }
}

// new Derived();`,
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
        'The Base constructor runs before Derived field initialisers. Virtual dispatch already selects Derived.print(), but x still holds its default value 0.',
    },
  },

  /* ---------------------------------------------------------------- 12  FINAL PREMIUM */
  {
    id: 'C12',
    index: 12,
    title: 'The Final Premium',
    category: 'optimization',
    type: 'numeric',
    difficulty: 'hard',
    marketType: 'final_premium',
    timeLimit: 240,
    accessKey: 'FIN-1212',
    question: {
      prompt:
        'FINAL PREMIUM. A trader may hold at most ONE share at a time and must sell before buying again. Given the daily prices below, what is the MAXIMUM total profit achievable across any number of transactions?',
      code: `prices = [7, 1, 5, 3, 6, 4, 9, 2]`,
      codeLanguage: 'python',
      placeholder: 'maximum total profit',
      unit: 'profit',
      hint: 'Unlimited transactions: capture every upward move.',
    },
    evaluation: {
      correctNumber: 12,
      tolerance: 0,
      explanation:
        'With unlimited transactions the optimum is the sum of every positive consecutive difference: (5-1) + (6-3) + (9-4) = 4 + 3 + 5 = 12.',
    },
  },
];

/** Optional supplementary pool used only when code execution is enabled. */
export const CODE_CHALLENGE_SAMPLE: Challenge = {
  id: 'CX1',
  index: 101,
  title: 'Runner Smoke Test',
  category: 'dsa',
  type: 'code',
  difficulty: 'easy',
  marketType: 'market',
  timeLimit: 300,
  accessKey: 'DEV-0001',
  question: {
    prompt:
      'Read a single integer n from standard input and print the sum of the first n natural numbers.',
    languages: ['python', 'cpp', 'java'],
    starterCode: '',
    samples: [
      { input: '5\n', output: '15' },
      { input: '1\n', output: '1' },
    ],
  },
  evaluation: {
    testCases: [
      { input: '5\n', output: '15' },
      { input: '1\n', output: '1' },
      { input: '100\n', output: '5050', hidden: true },
      { input: '0\n', output: '0', hidden: true },
    ],
    explanation: 'n*(n+1)/2, or an accumulating loop.',
  },
};
