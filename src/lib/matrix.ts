// The grade rule of a free competency matrix (/free/<slug>/, the matrices
// collection), shared by the page (the empty summary) and the browser script
// of MatrixChecker (it recounts on every tick), so both always agree.
//
// A grade counts when (step 5 of «Как пользоваться»):
// - every key item (●) of that grade and of the grades below is closed;
// - at least 80% of the grade's own items are closed, rounded up, counted
//   over the items left after striking out another role's ones (*);
// - no more than two regular items of the grades below are still open.
// The result is the highest grade that counts; none counted means the level
// of an intern or an assistant.

export type Grade = 'junior' | 'middle' | 'senior';
export const GRADES: Grade[] = ['junior', 'middle', 'senior'];
export const GRADE_NAME: Record<Grade, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };

export type MatrixSkill = { id: string; grade: Grade; key?: boolean; star?: boolean };

export type GradeState = {
  grade: Grade;
  total: number; // items of the grade left after striking out
  closed: number;
  need: number; // 80% of total, rounded up
  keys: number; // key items of this grade
  keysClosed: number;
  openKeys: string[]; // key items of this and lower grades still open
  lowerOpen: number; // regular items of the lower grades still open
  counted: boolean;
};

export type MatrixState = { grades: GradeState[]; result: Grade | null; next: GradeState | null };

export const SHARE = 0.8;
export const LOWER_OPEN_MAX = 2;

export function gradeState(skills: MatrixSkill[], checked: Set<string>, struck: Set<string>): MatrixState {
  const live = skills.filter((s) => !(s.star && struck.has(s.id)));
  const grades = GRADES.map((grade, gi): GradeState => {
    const own = live.filter((s) => s.grade === grade);
    const lower = live.filter((s) => GRADES.indexOf(s.grade) < gi);
    const total = own.length;
    const closed = own.filter((s) => checked.has(s.id)).length;
    const need = Math.ceil(total * SHARE - 1e-9);
    const keysOwn = own.filter((s) => s.key);
    const openKeys = [...lower, ...own].filter((s) => s.key && !checked.has(s.id)).map((s) => s.id);
    const lowerOpen = lower.filter((s) => !s.key && !checked.has(s.id)).length;
    return {
      grade,
      total,
      closed,
      need,
      keys: keysOwn.length,
      keysClosed: keysOwn.filter((s) => checked.has(s.id)).length,
      openKeys,
      lowerOpen,
      counted: total > 0 && openKeys.length === 0 && closed >= need && lowerOpen <= LOWER_OPEN_MAX,
    };
  });
  let result: Grade | null = null;
  for (const g of grades) if (g.counted) result = g.grade;
  const next = grades.find((g) => GRADES.indexOf(g.grade) > (result ? GRADES.indexOf(result) : -1)) ?? null;
  return { grades, result, next };
}

/** «Чтобы засчитать Middle: …» — what is missing for the next grade. */
export function missingFor(g: GradeState): string[] {
  const out: string[] = [];
  if (g.openKeys.length) out.push(`${g.openKeys.length === 1 ? 'ключевой пункт' : 'ключевые пункты'} ${g.openKeys.join(', ')}`);
  if (g.closed < g.need) out.push(`ещё ${g.need - g.closed} ${plural(g.need - g.closed, 'пункт', 'пункта', 'пунктов')} ${GRADE_NAME[g.grade]}`);
  if (g.lowerOpen > LOWER_OPEN_MAX) {
    const n = g.lowerOpen - LOWER_OPEN_MAX;
    out.push(`ещё ${n} ${plural(n, 'обычный пункт', 'обычных пункта', 'обычных пунктов')} грейдов ниже`);
  }
  return out;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
