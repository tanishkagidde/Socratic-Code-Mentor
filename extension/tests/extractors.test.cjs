// Run with:  node --test extension/tests
// Uses only Node's built-in test runner; no npm install needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../extractors/language.js");
const { scoreCodeText } = require("../extractors/generic.js");

test("labels use word boundaries (the old includes() bug)", () => {
  assert.equal(L.fromLabel("django"), null);
  assert.equal(L.fromLabel("algorithm"), null);
  assert.equal(L.fromLabel("Go"), "go");
  assert.equal(L.fromLabel("golang 1.22"), "go");
});

test("C++, C#, C and JavaScript vs Java are told apart", () => {
  assert.equal(L.fromLabel("C++"), "cpp");
  assert.equal(L.fromLabel("GNU G++17 7.3.0"), "cpp");
  assert.equal(L.fromLabel("C#"), "csharp");
  assert.equal(L.fromLabel("C"), "c");
  assert.equal(L.fromLabel("GNU C11"), "c");
  assert.equal(L.fromLabel("JavaScript"), "javascript");
  assert.equal(L.fromLabel("Java 21"), "java");
  assert.equal(L.fromLabel("TypeScript"), "typescript");
  assert.equal(L.fromLabel("Python3"), "python");
});

test("editor modes from Monaco, Ace and CodeMirror", () => {
  assert.equal(L.fromEditorMode("cpp"), "cpp");
  assert.equal(L.fromEditorMode("ace/mode/c_cpp"), "cpp");
  assert.equal(L.fromEditorMode("ace/mode/golang"), "go");
  assert.equal(L.fromEditorMode("text/x-java"), "java");
  assert.equal(L.fromEditorMode({ name: "javascript" }), "javascript");
  assert.equal(L.fromEditorMode("plaintext"), null);
});

const SAMPLES = {
  python: "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        return None",
  java: "class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        HashMap<Integer, Integer> m = new HashMap<>();\n        System.out.println(m);\n    }\n}",
  cpp: "#include <vector>\nusing namespace std;\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) { return {}; }\n};",
  c: "#include <stdio.h>\nint main() { int n; scanf(\"%d\", &n); printf(\"%d\", n); }",
  csharp: "using System;\npublic class Solution {\n    public int[] TwoSum(int[] nums, int target) { Console.WriteLine(1); return null; }\n}",
  javascript: "var twoSum = function(nums, target) {\n  const seen = new Map();\n  console.log(seen);\n};",
  typescript: "function twoSum(nums: number[], target: number): number[] {\n  const seen: Map<number, number> = new Map();\n  return [];\n}",
  go: "package main\nfunc twoSum(nums []int, target int) []int {\n    m := map[int]int{}\n    return nil\n}",
  rust: "impl Solution {\n    pub fn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n        let mut v = vec![];\n        v\n    }\n}",
  kotlin: "class Solution {\n    fun twoSum(nums: IntArray, target: Int): IntArray {\n        val seen = mutableMapOf<Int, Int>()\n        return intArrayOf()\n    }\n}",
  swift: "class Solution {\n    func twoSum(_ nums: [Int], _ target: Int) -> [Int] {\n        guard let first = nums.first else { return [] }\n        return [first]\n    }\n}",
  ruby: "def two_sum(nums, target)\n  nums.each do |n|\n    puts n\n  end\nend",
  php: "<?php\nfunction twoSum($nums, $target) {\n    $seen = [];\n}",
  sql: "SELECT name FROM Employee e LEFT JOIN Bonus b ON e.id = b.id",
};

for (const [lang, code] of Object.entries(SAMPLES)) {
  test(`code heuristic: ${lang}`, () => assert.equal(L.fromCode(code), lang));
}

test("detect() precedence: editor > page label > url > code", () => {
  const code = SAMPLES.python;
  assert.equal(L.detect({ editorMode: "java", labels: ["C++"], code }).source, "editor");
  assert.equal(L.detect({ labels: ["C++"], code }).id, "cpp");
  assert.equal(L.detect({ url: "https://www.programiz.com/python-programming/online-compiler/" }).id, "python");
  assert.equal(L.detect({ url: "https://example.com/go/problems/1" }), null, "ambiguous 'go' ignored in URLs");
  assert.equal(L.detect({ code }).source, "code");
});

test("code scoring prefers code over prose", () => {
  const code = scoreCodeText("for (int i = 0; i < n; i++) {\n    sum += a[i];\n}");
  const prose = scoreCodeText("Given an array of integers, return the sum of all the elements in the array.");
  assert.ok(code > 0.4, `code score ${code}`);
  assert.ok(prose < 0.2, `prose score ${prose}`);
});
