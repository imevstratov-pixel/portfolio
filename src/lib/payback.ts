// The payback calculator of the Задачка «Окупятся ли AI-агенты в разработке
// курсов» (Daniil's method of 19.10): hours per lesson from the top (people ×
// hours × share ÷ lessons, no time tracking), T-shirt sizes only split those
// hours between the stages, a human checks every stage the agents take,
// support hours and the neural network spend on top, payroll counted before
// and after, then the payback of the setup and the course's ceiling from its
// unit economics. Used on the server (the worked example) and in the browser
// (PaybackCalculator.astro), so both always agree.

export type Size = 'S' | 'M' | 'L';
export const SIZE_WEIGHT: Record<Size, number> = { S: 1, M: 5, L: 10 };

export type Stage = { name: string; size: Size; agent: boolean };

export type PaybackInput = {
  people: number; // methodologists who make the lessons
  lessons: number; // lessons a month
  hours: number; // working hours a month per person
  share: number; // share of their time on lessons, 0–1
  salary: number; // monthly salary before tax, ₽
  contributions: number; // employer contributions on top, 0–1
  stages: Stage[];
  humanLeft: number; // share of a stage's hours left to a human after the agents, 0–1
  support: number; // hours a month to support the agents
  spendPerLesson: number; // neural network spend per lesson, ₽
  setup: number; // setup price, ₽ (one for the whole school)
  courseLessons: number; // lessons in one course (the unit)
  courseBudget: number; // course development budget now, without payroll, ₽
  ceiling: number; // the most the course may cost to develop, without payroll, ₽
};

export const DEFAULT_STAGES: Stage[] = [
  { name: 'Ресёрч', size: 'M', agent: true },
  { name: 'План урока', size: 'S', agent: false },
  { name: 'Базовый текст', size: 'L', agent: true },
  { name: 'Картинки и схемы', size: 'S', agent: true },
  { name: 'Домашка и тесты', size: 'L', agent: true },
  { name: 'Редактура и сборка', size: 'M', agent: false },
];

// the worked example of the page: an exam-prep school, 40 lessons a month
export const DEFAULT_INPUT: PaybackInput = {
  people: 3,
  lessons: 40,
  hours: 160,
  share: 0.8,
  salary: 100_000,
  contributions: 0.3,
  stages: DEFAULT_STAGES,
  humanLeft: 0.25,
  support: 10,
  spendPerLesson: 1_000,
  setup: 80_000,
  courseLessons: 40,
  courseBudget: 500_000,
  ceiling: 800_000,
};

export type PaybackResult = {
  hoursBefore: number; // a month, on lessons
  hoursAfter: number;
  perLessonBefore: number;
  perLessonAfter: number;
  freed: number;
  freedShare: number;
  rate: number; // ₽ an hour with contributions
  costBefore: number; // payroll a month
  costAfter: number; // payroll + neural network a month
  lessonBefore: number;
  lessonAfter: number;
  saving: number; // a month
  paybackMonths: number | null; // null: it does not pay off
  courseCost: number; // the course without payroll after: budget + setup + spend
  fitsCeiling: boolean;
  ceilingLeft: number;
  monthCap: number; // the spend cap to set a month
};

export function payback(i: PaybackInput): PaybackResult {
  const hoursBefore = i.people * i.hours * i.share;
  const rate = i.hours > 0 ? (i.salary * (1 + i.contributions)) / i.hours : 0;
  const weights = i.stages.reduce((s, st) => s + SIZE_WEIGHT[st.size], 0) || 1;
  const stageHours = i.stages.map((st) => (hoursBefore * SIZE_WEIGHT[st.size]) / weights);
  const agentHours = stageHours.reduce((s, h, k) => s + (i.stages[k].agent ? h : 0), 0);
  const humanHours = hoursBefore - agentHours;
  const hoursAfter = agentHours * i.humanLeft + humanHours + (agentHours > 0 ? i.support : 0);
  const lessons = Math.max(i.lessons, 0);
  const costBefore = hoursBefore * rate;
  const spend = agentHours > 0 ? i.spendPerLesson * lessons : 0;
  const costAfter = hoursAfter * rate + spend;
  const saving = costBefore - costAfter;
  const courseCost = i.courseBudget + i.setup + i.spendPerLesson * i.courseLessons;
  // the month cap: 1.5 × the expected spend, but never above what the ceiling leaves
  const leftForSpend = i.ceiling - i.courseBudget - i.setup;
  const perLessonLimit = i.courseLessons > 0 ? leftForSpend / i.courseLessons : 0;
  const monthCap = Math.max(0, Math.min(spend * 1.5, perLessonLimit * lessons));
  return {
    hoursBefore,
    hoursAfter,
    perLessonBefore: lessons ? hoursBefore / lessons : 0,
    perLessonAfter: lessons ? hoursAfter / lessons : 0,
    freed: hoursBefore - hoursAfter,
    freedShare: hoursBefore ? (hoursBefore - hoursAfter) / hoursBefore : 0,
    rate,
    costBefore,
    costAfter,
    lessonBefore: lessons ? costBefore / lessons : 0,
    lessonAfter: lessons ? costAfter / lessons : 0,
    saving,
    paybackMonths: saving > 0 ? i.setup / saving : null,
    courseCost,
    fitsCeiling: courseCost <= i.ceiling,
    ceilingLeft: i.ceiling - courseCost,
    monthCap,
  };
}

const NBSP = ' ';
/** 142000 → «142 000», 9.6 → «9,6» (Russian digits, a no-break space between groups). */
export function num(n: number, digits = 0): string {
  const f = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  // round first, then drop the sign of a zero: −0,26 → «0», never «−0»
  const v = Number.isFinite(n) ? Number(n.toFixed(digits)) || 0 : 0;
  return f.format(v).replace(/[\s\u202f]/g, NBSP).replace('-', '−');
}
export const rub = (n: number) => `${num(Math.round(n))}${NBSP}₽`;
