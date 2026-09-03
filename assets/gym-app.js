import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://ztsdkfwnqrlmsirfvoat.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0c2RrZnducXJsbXNpcmZ2b2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwOTM5OTksImV4cCI6MjA5ODY2OTk5OX0.ODimfaCqTpK8fkY4Oobk8kSR3rppb_afmoTTXG8H2os';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Panel de administración: solo visible/operativo para el propietario de la
// app (comprobado también en el servidor, en la función gym_admin_stats, así
// que ocultarlo aquí es solo para no confundir a otros usuarios).
const ADMIN_EMAIL = 'ernestobm2012@gmail.com';
function isAdmin() {
  return !!(state.session && state.session.user && state.session.user.email === ADMIN_EMAIL);
}

// ---------------------------------------------------------------------------
// Estado en memoria de la sesión actual
// ---------------------------------------------------------------------------
const state = {
  session: null,
  profile: null,
  measurements: [],
  exercises: [],
  tab: 'resumen',
  routineSeed: 0,
  routineOverrides: {},
  selectedExerciseId: null,
  exerciseDetailLoading: false,
  exerciseLogs: [],
  exerciseNote: '',
  allExerciseLogs: [],
  calendarMonth: (() => { const d = new Date(); d.setDate(1); return d; })(),
  selectedCalendarDate: todayISO(),
  selectedRoutineDay: null,
  stretchSectionOpen: false,
  editingWeekdayPlan: false,
  adminStats: null,
  adminLoading: false,
  adminError: null,
  authMode: null,
  passwordRecovery: false,
};

const GOAL_LABELS = {
  perdida_peso: 'Pérdida de peso',
  definicion: 'Definición',
  volumen: 'Aumento de masa (volumen)',
};

const ACTIVITY_LABELS = {
  sedentario: 'Sedentario (poco o ningún ejercicio)',
  ligero: 'Ligero (1-3 días/semana)',
  moderado: 'Moderado (3-5 días/semana)',
  activo: 'Activo (6-7 días/semana)',
  muy_activo: 'Muy activo (trabajo físico o 2 veces/día)',
};

const ACTIVITY_FACTORS = {
  sedentario: 1.2,
  ligero: 1.375,
  moderado: 1.55,
  activo: 1.725,
  muy_activo: 1.9,
};

const MUSCLE_LABELS = {
  pecho: 'Pecho', espalda: 'Espalda', piernas: 'Piernas', gluteos: 'Glúteos',
  hombros: 'Hombros', brazos: 'Brazos', core: 'Core / abdomen', cardio: 'Cardio',
  estiramiento: 'Estiramiento',
};

const STRETCH_TIMING_LABELS = { antes: 'Antes de entrenar', despues: 'Después de entrenar', ambos: 'Antes o después' };

const INJURY_LABELS = {
  hombro: 'Hombro', espalda_baja: 'Espalda baja', rodilla: 'Rodilla',
  muñeca: 'Muñeca', codo: 'Codo', cadera: 'Cadera', tobillo: 'Tobillo',
};

function injuriesFieldsetHTML(selected) {
  const sel = selected || [];
  return `
    <fieldset>
      <legend>¿Alguna lesión o molestia? (opcional)</legend>
      ${Object.entries(INJURY_LABELS).map(([v, l]) => `
        <label class="radio"><input type="checkbox" name="injuries" value="${v}" ${sel.includes(v) ? 'checked' : ''} /> ${l}</label>
      `).join('')}
      <p class="muted" style="margin: 8px 0 0;">Evitaremos en lo posible los ejercicios de más riesgo para esa zona. No sustituye el consejo de un profesional.</p>
    </fieldset>
  `;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmt1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(1));
const fmt0 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Math.round(n));
function todayISO() { return new Date().toISOString().slice(0, 10); }

function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate + 'T00:00:00');
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const h = heightCm / 100;
  return weightKg / (h * h);
}

function bmiCategory(value) {
  if (value === null) return { label: '—', tone: '' };
  if (value < 18.5) return { label: 'Bajo peso', tone: 'warn' };
  if (value < 25) return { label: 'Peso saludable', tone: 'good' };
  if (value < 30) return { label: 'Sobrepeso', tone: 'warn' };
  return { label: 'Obesidad', tone: 'bad' };
}

function waistRisk(waistCm, sex) {
  if (!waistCm) return null;
  const high = sex === 'hombre' ? 102 : 88;
  const mid = sex === 'hombre' ? 94 : 80;
  if (waistCm >= high) return { label: 'Riesgo alto', tone: 'bad' };
  if (waistCm >= mid) return { label: 'Riesgo aumentado', tone: 'warn' };
  return { label: 'Riesgo bajo', tone: 'good' };
}

// Fórmula de Mifflin-St Jeor, distinta para hombre/mujer.
function bmr({ sex, weightKg, heightCm, age }) {
  if (!weightKg || !heightCm || !age) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'hombre' ? base + 5 : base - 161;
}

function dietTargets(profile, latestWeight) {
  const age = ageFromBirthDate(profile.birth_date);
  const weight = latestWeight ?? null;
  const base = bmr({ sex: profile.sex, weightKg: weight, heightCm: profile.height_cm, age });
  if (base === null) return null;
  const tdee = base * (ACTIVITY_FACTORS[profile.activity_level] || 1.55);

  let calories = tdee;
  let proteinPerKg = 1.8;
  if (profile.goal === 'perdida_peso') {
    calories = tdee - 500;
    proteinPerKg = 1.9;
  } else if (profile.goal === 'definicion') {
    calories = tdee - 250;
    proteinPerKg = 2.0;
  } else if (profile.goal === 'volumen') {
    calories = tdee + 300;
    proteinPerKg = 1.9;
  }
  const safetyFloor = profile.sex === 'hombre' ? 1500 : 1200;
  calories = Math.max(calories, safetyFloor);

  const proteinG = proteinPerKg * weight;
  const fatG = (calories * 0.25) / 9;
  const proteinKcal = proteinG * 4;
  const fatKcal = fatG * 9;
  const carbsKcal = Math.max(calories - proteinKcal - fatKcal, 0);
  const carbsG = carbsKcal / 4;

  return {
    tdee, calories, proteinG, fatG, carbsG,
  };
}

// ---------------------------------------------------------------------------
// Alimentos concretos por comida: a partir de las calorías/macros de cada
// comida (mismo % que su reparto calórico), calcula gramos de una fuente de
// proteína, una de carbohidrato y (si hace falta) una de grasa, restando la
// grasa que ya aportan las otras dos. Valores nutricionales por 100 g.
// ---------------------------------------------------------------------------
const FOODS = {
  huevo: { name: 'Huevo entero cocido', kcal: 155, p: 13, c: 1.1, f: 11 },
  pollo: { name: 'Pechuga de pollo a la plancha', kcal: 165, p: 31, c: 0, f: 3.6 },
  yogurGriego: { name: 'Yogur griego 0%', kcal: 59, p: 10, c: 3.6, f: 0.4 },
  salmon: { name: 'Salmón a la plancha', kcal: 208, p: 20, c: 0, f: 13 },
  avena: { name: 'Avena en copos', kcal: 389, p: 17, c: 66, f: 7 },
  arroz: { name: 'Arroz blanco cocido', kcal: 130, p: 2.7, c: 28, f: 0.3 },
  manzana: { name: 'Manzana', kcal: 52, p: 0.3, c: 14, f: 0.2 },
  patata: { name: 'Patata cocida', kcal: 87, p: 2, c: 20, f: 0.1 },
  almendras: { name: 'Almendras', kcal: 579, p: 21, c: 22, f: 50 },
  aceite: { name: 'Aceite de oliva virgen extra', kcal: 884, p: 0, c: 0, f: 100 },
};

const MEAL_TEMPLATES = [
  { label: 'Desayuno', pct: 0.25, protein: 'huevo', carb: 'avena', fat: 'almendras', extra: null },
  { label: 'Comida', pct: 0.35, protein: 'pollo', carb: 'arroz', fat: 'aceite', extra: 'Verdura o ensalada, la cantidad que quieras' },
  { label: 'Merienda', pct: 0.15, protein: 'yogurGriego', carb: 'manzana', fat: null, extra: null },
  { label: 'Cena', pct: 0.25, protein: 'salmon', carb: 'patata', fat: null, extra: 'Verdura o ensalada, la cantidad que quieras' },
];

// Suplementos habituales de gimnasio: información orientativa general, no
// dosis personalizadas ni sustituto del consejo médico (ver aviso en la UI).
const SUPPLEMENTS = [
  { name: 'Proteína en polvo (whey o vegetal)', dose: '20-30 g por toma', note: 'Para completar tu objetivo diario de proteína cuando no llegas solo con comida.' },
  { name: 'Creatina monohidrato', dose: '3-5 g al día, todos los días', note: 'Uno de los suplementos más estudiados: mejora el rendimiento en series de fuerza y ayuda a ganar masa magra.' },
  { name: 'Magnesio', dose: '300-400 mg al día', note: 'Interviene en la función muscular y el descanso; útil si entrenas fuerte o sudas mucho.' },
  { name: 'Omega-3 (aceite de pescado)', dose: '1-2 g de EPA+DHA al día', note: 'Apoya la salud cardiovascular y puede ayudar a reducir la inflamación tras entrenar.' },
  { name: 'Vitamina D', dose: 'Según niveles (mejor con analítica)', note: 'Muy habitual tenerla baja con poca exposición al sol; interviene en huesos y sistema inmune.' },
  { name: 'Cafeína', dose: '100-200 mg, 30-45 min antes de entrenar', note: 'Mejora el rendimiento y la sensación de energía durante el entrenamiento.' },
];

const SUPPLEMENT_GOAL_NOTES = {
  perdida_peso: 'En déficit calórico la prioridad es la proteína, para no perder masa muscular junto con la grasa; la cafeína puede ayudarte a rendir mejor cuando hay menos energía disponible.',
  definicion: 'Con proteína alta y algo de déficit, la creatina ayuda a mantener el rendimiento en el gimnasio mientras defines.',
  volumen: 'Para ganar masa, la creatina es de los suplementos con más respaldo, junto con cubrir bien la proteína diaria.',
};

function roundGrams(g) {
  return Math.max(5, Math.round(g / 5) * 5);
}

function mealFoodPlan(targets, template) {
  const mealProteinG = targets.proteinG * template.pct;
  const mealCarbsG = targets.carbsG * template.pct;
  const mealFatG = targets.fatG * template.pct;

  const proteinFood = template.protein ? FOODS[template.protein] : null;
  const carbFood = template.carb ? FOODS[template.carb] : null;

  // La comida de "carbohidrato" también aporta algo de proteína (p. ej. la
  // avena tiene bastante), así que resolvemos las dos incógnitas a la vez
  // en vez de calcular cada una por separado y contar esa proteína dos veces.
  let proteinGrams = 0;
  let carbGrams = 0;
  if (proteinFood && carbFood) {
    const a = proteinFood.p / 100, b = carbFood.p / 100;
    const c = proteinFood.c / 100, d = carbFood.c / 100;
    const det = a * d - b * c;
    if (Math.abs(det) > 1e-6) {
      proteinGrams = (mealProteinG * d - mealCarbsG * b) / det;
      carbGrams = (mealCarbsG * a - mealProteinG * c) / det;
    } else {
      proteinGrams = mealProteinG / a;
    }
  } else if (proteinFood) {
    proteinGrams = mealProteinG / (proteinFood.p / 100);
  } else if (carbFood) {
    carbGrams = mealCarbsG / (carbFood.c / 100);
  }
  proteinGrams = Math.max(proteinGrams, 0);
  carbGrams = Math.max(carbGrams, 0);

  const items = [];
  let fatCovered = 0;
  if (proteinFood) {
    const grams = roundGrams(proteinGrams);
    fatCovered += (grams / 100) * proteinFood.f;
    items.push({ name: proteinFood.name, grams, kcal: Math.round((grams / 100) * proteinFood.kcal) });
  }
  if (carbFood) {
    const grams = roundGrams(carbGrams);
    fatCovered += (grams / 100) * carbFood.f;
    items.push({ name: carbFood.name, grams, kcal: Math.round((grams / 100) * carbFood.kcal) });
  }
  if (template.fat) {
    const food = FOODS[template.fat];
    const remainingFat = Math.max(mealFatG - fatCovered, 0);
    if (remainingFat > 1) {
      const grams = roundGrams(remainingFat / (food.f / 100));
      items.push({ name: food.name, grams, kcal: Math.round((grams / 100) * food.kcal) });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Generador de rutina: reparte ejercicios del catálogo en un split semanal
// según los días/semana y el objetivo del perfil.
// ---------------------------------------------------------------------------
// Cada día combina al menos 3 grupos musculares. Con solo 2 grupos/día
// (diseño anterior) tocaba usar 4 ejercicios de cada grupo, y como algunos
// grupos apenas tienen 3-5 ejercicios en el catálogo, eso obligaba a repetir
// casi todo el catálogo cada día y dejaba muy poco margen para renovar la
// rutina de una semana a la siguiente. Con 3-4 grupos/día basta con 2-3 de
// cada uno, lo que dobla el margen de rotación semanal sin tocar el catálogo.
const SPLITS = {
  2: [['pecho', 'espalda', 'piernas', 'core'], ['hombros', 'brazos', 'gluteos', 'cardio']],
  3: [['pecho', 'hombros', 'brazos'], ['espalda', 'brazos', 'core'], ['piernas', 'gluteos', 'cardio']],
  4: [
    ['pecho', 'hombros', 'brazos'],
    ['espalda', 'brazos', 'core'],
    ['piernas', 'gluteos', 'core'],
    ['hombros', 'cardio', 'core'],
  ],
  5: [
    ['pecho', 'hombros', 'core'],
    ['espalda', 'cardio', 'core'],
    ['piernas', 'gluteos', 'cardio'],
    ['hombros', 'brazos', 'core'],
    ['espalda', 'brazos', 'cardio'],
  ],
  6: [
    ['pecho', 'hombros', 'brazos'],
    ['espalda', 'brazos', 'core'],
    ['piernas', 'gluteos', 'cardio'],
    ['pecho', 'hombros', 'core'],
    ['espalda', 'brazos', 'cardio'],
    ['piernas', 'gluteos', 'core'],
  ],
};

// A qué día de la semana (0 = lunes ... 6 = domingo) corresponde cada día
// de la rutina, para que "Rutina" muestre por defecto el entrenamiento de
// hoy en vez de todos los días seguidos (y así no se mezclen ejercicios de
// días distintos).
const ROUTINE_WEEKDAYS = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};
const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Combinaciones de grupos musculares para "días nuevos" que el usuario añade
// a mano por encima de sus días/semana habituales (no vienen de SPLITS, que
// está pensado para un número fijo de días). Rotan en bucle si se añaden
// muchos días nuevos.
const EXTRA_DAY_SPLITS = [
  ['pecho', 'espalda', 'piernas'],
  ['hombros', 'brazos', 'core'],
  ['gluteos', 'cardio', 'core'],
  ['pecho', 'hombros', 'piernas'],
  ['espalda', 'brazos', 'cardio'],
  ['gluteos', 'core', 'hombros'],
];

// Como mucho un día de rutina distinto por cada día de la semana (7, 0-based
// hasta 6): no tiene sentido guardar más variantes de las que caben en una
// semana.
const MAX_ROUTINE_DAY_INDEX = 6;

function todayWeekdayIndex() {
  return (new Date().getDay() + 6) % 7;
}

// Qué día de la rutina (0-based) toca cada día de la semana. Por defecto usa
// ROUTINE_WEEKDAYS según los días/semana del perfil, pero el usuario puede
// personalizarlo desde "Rutina" (añadir un día suelto, moverlo de sitio,
// entrenar más o menos días una semana concreta) sin tocar su configuración
// habitual de días/semana en Perfil. Se guarda en gym_profiles.weekday_plan
// como un array de 7 posiciones (lunes..domingo) con el índice del día de
// rutina que toca ese día, o null si es descanso. Los índices >= días/semana
// del perfil son "días nuevos" generados aparte (ver EXTRA_DAY_SPLITS).
function weekdayPlanFor(profile) {
  const stored = profile.weekday_plan;
  if (Array.isArray(stored) && stored.length === 7) {
    return stored.map((v) => (Number.isInteger(v) && v >= 0 && v <= MAX_ROUTINE_DAY_INDEX) ? v : null);
  }
  const defaultWeekdays = ROUTINE_WEEKDAYS[profile.days_per_week] || ROUTINE_WEEKDAYS[3];
  const plan = Array(7).fill(null);
  defaultWeekdays.forEach((wd, i) => { plan[wd] = i; });
  return plan;
}

// Cuántos "días nuevos" (por encima de los días/semana habituales) hacen
// falta para cubrir el índice más alto que aparezca en el plan.
function extraDaysCountFor(plan, baseCount) {
  const maxIndex = plan.reduce((max, v) => (v !== null && v > max ? v : max), baseCount - 1);
  return Math.max(0, maxIndex - baseCount + 1);
}

// Inverso de weekdayPlanFor: para cada día de rutina (0..n-1), qué días de la
// semana lo tienen asignado (puede ser ninguno, uno, o varios si el usuario
// repite un día de rutina en más de un día de la semana).
function weekdaysByRoutineDay(plan, n) {
  const map = Array.from({ length: n }, () => []);
  plan.forEach((dayIndex, wd) => { if (dayIndex !== null) map[dayIndex].push(wd); });
  return map;
}

// Identificador de semana ISO (año*100 + nº de semana) para que la rutina
// cambie sola cada semana sin que haga falta pulsar nada: todos los días de
// una misma semana natural generan el mismo plan, y al empezar la semana
// siguiente el número cambia y con él la selección de ejercicios.
function isoWeekSeed(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + firstThursdayDayNum) / 7);
  return d.getUTCFullYear() * 100 + week;
}

// state.routineSeed es un desplazamiento manual (botón "Generar otra
// variante"); se suma a la semana actual para que ese botón también evite
// repetir lo último generado, igual que el cambio automático semanal.
function currentRoutineSeed() {
  return isoWeekSeed() + state.routineSeed;
}

const GOAL_VOLUME = {
  perdida_peso: { sets: 3, reps: '12-15', rest: '30-45 seg' },
  definicion: { sets: 3, reps: '10-15', rest: '45-60 seg' },
  volumen: { sets: 4, reps: '6-10', rest: '60-90 seg' },
};

function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isSafeForInjuries(exercise, injuries) {
  if (!injuries || injuries.length === 0) return true;
  const caution = exercise.caution_for || [];
  return !caution.some((zone) => injuries.includes(zone));
}

// Cuántos ejercicios queremos por sesión. El objetivo (perdida_peso/
// definicion/volumen) no filtra qué ejercicios entran —eso lo decide el
// grupo muscular y, si aplica, la lesión— sino las series/reps/descanso
// (ver GOAL_VOLUME), que es donde de verdad cambia un plan según el
// objetivo.
const DAY_EXERCISE_TARGET = 8;

function exercisePoolForGroup(exercises, group, injuries) {
  let pool = exercises.filter((e) => e.muscle_group === group && isSafeForInjuries(e, injuries));
  if (pool.length === 0) {
    // Sin alternativa segura para esta lesión: mejor mostrar la opción
    // normal (avisada en el detalle) que dejar el hueco vacío.
    pool = exercises.filter((e) => e.muscle_group === group);
  }
  return pool;
}

// Reordena "pool" empezando en un punto que depende de "seed" y dando la
// vuelta en bucle (módulo el tamaño del catálogo), sin repetir ningún
// elemento. El orden base de "pool" es fijo (no depende de la semana); lo
// único que cambia con el seed es el punto de partida, desplazado
// exactamente "step" posiciones respecto al seed anterior. Así, mientras
// el catálogo tenga al menos 2×step ejercicios, esta semana y la anterior
// no comparten ninguno de los primeros "step"; con catálogos más pequeños
// el solape es el mínimo matemáticamente posible.
function rotatePoolOrder(pool, seed, step) {
  if (pool.length === 0) return [];
  const offset = ((seed * step) % pool.length + pool.length) % pool.length;
  return pool.map((_, idx) => pool[(offset + idx) % pool.length]);
}

// Cuántos ejercicios saldrán de cada grupo muscular un día dado, repartiendo
// los huecos que dejen los grupos con poco catálogo (p. ej. glúteos) entre
// el resto para acercarse a DAY_EXERCISE_TARGET. Depende solo del tamaño de
// cada catálogo (no de la semana), así que es igual semana a semana; esto
// permite luego rotar cada grupo exactamente su propio número de ejercicios
// en vez de un paso genérico, y así no repetir nada de una semana a otra
// mientras el catálogo del grupo llegue a duplicar ese número.
function groupCountsForDay(poolLengths) {
  const basePerGroup = Math.max(2, Math.floor(DAY_EXERCISE_TARGET / poolLengths.length));
  const counts = poolLengths.map((len) => Math.min(basePerGroup, len));
  let total = counts.reduce((sum, c) => sum + c, 0);
  let addedMore = true;
  while (total < DAY_EXERCISE_TARGET && addedMore) {
    addedMore = false;
    for (let gi = 0; gi < counts.length && total < DAY_EXERCISE_TARGET; gi++) {
      if (counts[gi] < poolLengths[gi]) {
        counts[gi]++;
        total++;
        addedMore = true;
      }
    }
  }
  return counts;
}

function generateRoutine(profile, exercises, seed, extraDaysCount = 0) {
  const baseDays = SPLITS[profile.days_per_week] || SPLITS[3];
  const extraDays = Array.from({ length: extraDaysCount }, (_, i) => EXTRA_DAY_SPLITS[i % EXTRA_DAY_SPLITS.length]);
  const days = baseDays.concat(extraDays);
  const injuries = profile.injuries || [];

  return days.map((groups, i) => {
    const stablePools = groups.map((group) => seededShuffle(exercisePoolForGroup(exercises, group, injuries), i + group.length));
    const counts = groupCountsForDay(stablePools.map((pool) => pool.length));
    const picked = stablePools.map((pool, gi) => rotatePoolOrder(pool, seed, counts[gi]).slice(0, counts[gi]));

    return { label: `Día ${i + 1} — ${groups.map((g) => MUSCLE_LABELS[g]).join(' + ')}`, exercises: picked.flat() };
  });
}

// Sustituye, dentro de la rutina ya generada, los ejercicios que el
// usuario haya cambiado a mano (p. ej. porque no tiene esa máquina) por
// su alternativa elegida. La clave es "díaÍndice-puestoÍndice" para que
// el cambio se mantenga aunque se vuelva a renderizar, pero se olvide al
// generar una variante nueva o cambiar el perfil.
function applyRoutineOverrides(routine) {
  return routine.map((day, dayIndex) => ({
    ...day,
    exercises: day.exercises.map((ex, slotIndex) => {
      const overrideId = state.routineOverrides[`${dayIndex}-${slotIndex}`];
      if (!overrideId) return ex;
      const replacement = state.exercises.find((e) => e.id === overrideId);
      return replacement || ex;
    }),
  }));
}

// ---------------------------------------------------------------------------
// Diagrama corporal esquemático: resalta la zona muscular trabajada
// ---------------------------------------------------------------------------
const BODY_ZONES = {
  head: { shape: 'circle', cx: 80, cy: 22, r: 16 },
  shoulders: { shape: 'rect', x: 38, y: 42, w: 84, h: 14, rx: 7 },
  chest: { shape: 'rect', x: 50, y: 58, w: 60, h: 38, rx: 8 },
  armL: { shape: 'rect', x: 18, y: 58, w: 16, h: 86, rx: 8 },
  armR: { shape: 'rect', x: 126, y: 58, w: 16, h: 86, rx: 8 },
  core: { shape: 'rect', x: 54, y: 98, w: 52, h: 38, rx: 8 },
  hips: { shape: 'rect', x: 50, y: 138, w: 60, h: 22, rx: 10 },
  legL: { shape: 'rect', x: 50, y: 162, w: 22, h: 104, rx: 11 },
  legR: { shape: 'rect', x: 88, y: 162, w: 22, h: 104, rx: 11 },
};
const BODY_ZONE_ORDER = ['legL', 'legR', 'hips', 'core', 'armL', 'armR', 'chest', 'shoulders', 'head'];
const ACTIVE_ZONES_BY_GROUP = {
  pecho: ['chest'],
  espalda: ['chest', 'core'],
  piernas: ['legL', 'legR'],
  gluteos: ['hips'],
  hombros: ['shoulders'],
  brazos: ['armL', 'armR'],
  core: ['core'],
  cardio: ['chest', 'core'],
};
const BACK_VIEW_GROUPS = new Set(['espalda', 'gluteos']);

function bodyDiagramSVG(muscleGroup, cssClass) {
  const active = ACTIVE_ZONES_BY_GROUP[muscleGroup] || [];
  const shapes = BODY_ZONE_ORDER.map((key) => {
    const z = BODY_ZONES[key];
    const fill = active.includes(key) ? '#e0645b' : '#3a4150';
    return z.shape === 'circle'
      ? `<circle cx="${z.cx}" cy="${z.cy}" r="${z.r}" fill="${fill}" />`
      : `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="${z.rx}" fill="${fill}" />`;
  }).join('');
  const heart = muscleGroup === 'cardio' ? `<text x="80" y="86" font-size="24" text-anchor="middle">❤️</text>` : '';
  return `<svg viewBox="0 0 160 280" class="${cssClass}" role="img" aria-label="Zona trabajada: ${MUSCLE_LABELS[muscleGroup]}">${shapes}${heart}</svg>`;
}

function bodyDiagram(muscleGroup) {
  const viewLabel = BACK_VIEW_GROUPS.has(muscleGroup) ? 'Vista trasera' : 'Vista frontal';
  return `
    <div class="muscle-diagram-wrap">
      ${bodyDiagramSVG(muscleGroup, 'muscle-diagram')}
      <p class="muted" style="text-align:center;">${viewLabel} — ${MUSCLE_LABELS[muscleGroup]}</p>
    </div>
  `;
}

// Versión compacta del diagrama corporal para las filas de la rutina: solo
// el silueta con la zona resaltada y el nombre del grupo, sin la etiqueta
// de "vista frontal/trasera" (no cabe en una fila estrecha).
function bodyDiagramMini(muscleGroup) {
  return `
    <div class="muscle-diagram-mini">
      ${bodyDiagramSVG(muscleGroup, 'muscle-diagram-mini-svg')}
      <span>${MUSCLE_LABELS[muscleGroup]}</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Animación esquemática del patrón de movimiento (SVG + CSS, en bucle)
// Todas parten de una misma figura humana esquemática (cabeza + torso +
// piernas) para que se lea como "una persona haciendo el movimiento" y no
// como un icono suelto de pesas.
// ---------------------------------------------------------------------------
const FIGURE_HEAD_TORSO = `
  <circle cx="80" cy="16" r="10" fill="#5b8def" />
  <rect x="68" y="28" width="24" height="34" rx="8" fill="#9aa4b2" />
`;
const FIGURE_LEGS_STANDING = `
  <line x1="74" y1="60" x2="68" y2="86" stroke="#9aa4b2" stroke-width="6" stroke-linecap="round" />
  <line x1="86" y1="60" x2="92" y2="86" stroke="#9aa4b2" stroke-width="6" stroke-linecap="round" />
`;

function pushSVG() {
  // Brazo por encima de la cabeza empujando un peso hacia arriba (press).
  return `<svg viewBox="0 0 160 90" class="movement-svg">
    <line x1="20" y1="86" x2="140" y2="86" stroke="#2a303a" stroke-width="3" />
    ${FIGURE_LEGS_STANDING}
    ${FIGURE_HEAD_TORSO}
    <g class="anim-push">
      <line x1="90" y1="32" x2="100" y2="14" stroke="#9aa4b2" stroke-width="6" stroke-linecap="round" />
      <rect x="90" y="4" width="20" height="8" rx="2" fill="#5b8def" />
    </g>
  </svg>`;
}
function pullSVG() {
  // Brazo flexionado tirando de un cable (línea discontinua) hacia el pecho.
  return `<svg viewBox="0 0 160 90" class="movement-svg">
    <line x1="20" y1="86" x2="140" y2="86" stroke="#2a303a" stroke-width="3" />
    ${FIGURE_LEGS_STANDING}
    ${FIGURE_HEAD_TORSO}
    <line x1="16" y1="46" x2="66" y2="46" stroke="#2a303a" stroke-width="3" stroke-dasharray="5 4" />
    <g class="anim-pull">
      <line x1="66" y1="40" x2="48" y2="46" stroke="#9aa4b2" stroke-width="6" stroke-linecap="round" />
      <circle cx="44" cy="46" r="6" fill="#5b8def" />
    </g>
  </svg>`;
}
function squatSVG(cls) {
  return `<svg viewBox="0 0 160 90" class="movement-svg">
    <line x1="20" y1="82" x2="140" y2="82" stroke="#2a303a" stroke-width="3" />
    <g class="${cls}">
      ${FIGURE_HEAD_TORSO}
      <line x1="72" y1="58" x2="65" y2="80" stroke="#9aa4b2" stroke-width="5" stroke-linecap="round" />
      <line x1="88" y1="58" x2="95" y2="80" stroke="#9aa4b2" stroke-width="5" stroke-linecap="round" />
    </g>
  </svg>`;
}
function raiseSVG(cls) {
  return `<svg viewBox="0 0 160 90" class="movement-svg">
    <line x1="20" y1="86" x2="140" y2="86" stroke="#2a303a" stroke-width="3" />
    ${FIGURE_LEGS_STANDING}
    ${FIGURE_HEAD_TORSO}
    <g class="${cls}">
      <line x1="80" y1="38" x2="80" y2="70" stroke="#9aa4b2" stroke-width="6" stroke-linecap="round" />
      <circle cx="80" cy="72" r="6" fill="#5b8def" />
    </g>
  </svg>`;
}
function coreSVG(cls) {
  return `<svg viewBox="0 0 160 90" class="movement-svg">
    <line x1="20" y1="70" x2="140" y2="70" stroke="#2a303a" stroke-width="3" />
    <g class="${cls}">
      <rect x="35" y="46" width="90" height="16" rx="8" fill="#9aa4b2" />
      <circle cx="30" cy="54" r="9" fill="#5b8def" />
    </g>
  </svg>`;
}
function cardioSVG() {
  // Piernas alternas (tijera), como al correr o pedalear.
  return `<svg viewBox="0 0 160 90" class="movement-svg">
    <line x1="20" y1="86" x2="140" y2="86" stroke="#2a303a" stroke-width="3" />
    ${FIGURE_HEAD_TORSO}
    <line x1="80" y1="60" x2="80" y2="62" stroke="#9aa4b2" stroke-width="1" />
    <line x1="80" y1="60" x2="60" y2="84" stroke="#9aa4b2" stroke-width="6" stroke-linecap="round" class="anim-cardio-a" />
    <line x1="80" y1="60" x2="100" y2="84" stroke="#9aa4b2" stroke-width="6" stroke-linecap="round" class="anim-cardio-b" />
  </svg>`;
}
const MOVEMENT_DEFS = {
  push: { label: 'Empuje', svg: () => pushSVG() },
  pull: { label: 'Tirón', svg: () => pullSVG() },
  squat: { label: 'Flexión de piernas / cadera', svg: () => squatSVG('anim-squat') },
  raise: { label: 'Elevación', svg: () => raiseSVG('anim-raise') },
  core: { label: 'Tensión de core', svg: () => coreSVG('anim-core') },
  cardio: { label: 'Movimiento continuo', svg: () => cardioSVG() },
  stretch: { label: 'Estiramiento sostenido', svg: () => raiseSVG('anim-core') },
};
function movementAnimation(type) {
  const def = MOVEMENT_DEFS[type] || MOVEMENT_DEFS.push;
  return `
    <div class="movement-anim">
      ${def.svg()}
      <p class="muted" style="text-align:center;">${def.label} (animación esquemática)</p>
    </div>
  `;
}

// Dos fotogramas reales (inicio/fin del movimiento) en bucle, de un banco de
// imágenes de dominio público (Free Exercise DB, licencia Unlicense).
function exercisePhotoLoop(photoRef, name) {
  if (!photoRef) return null;
  const base = `./assets/exercise-photos/${photoRef}/`;
  return `
    <div class="photo-loop">
      <img src="${base}0.jpg" alt="${name} — fotograma 1" class="photo-frame photo-frame-a" loading="lazy" />
      <img src="${base}1.jpg" alt="${name} — fotograma 2" class="photo-frame photo-frame-b" loading="lazy" />
    </div>
  `;
}

// Miniatura cuadrada para las filas de la rutina: una sola foto fija (no en
// bucle, para no distraer en una lista) o, si el ejercicio no tiene foto, el
// icono del patrón de movimiento como respaldo.
function exerciseThumb(ex) {
  if (ex.photo_ref) {
    return `<img src="./assets/exercise-photos/${ex.photo_ref}/0.jpg" alt="${ex.name}" class="exercise-thumb-img" loading="lazy" />`;
  }
  return `<span class="exercise-thumb-fallback" aria-hidden="true">${(MOVEMENT_DEFS[ex.movement_type] || MOVEMENT_DEFS.push).svg()}</span>`;
}

// Fila compacta para los estiramientos opcionales: foto + nombre + marcar
// hecho, sin series/reps ni diagrama muscular (todos comparten el mismo
// grupo "estiramiento", así que no aportaría información).
function stretchRowHTML(ex) {
  const done = isDoneToday(ex.id);
  return `
    <div class="exercise-row exercise-row-compact">
      <button class="exercise-row-thumb" data-open-exercise="${ex.id}" aria-label="Ver detalle de ${ex.name}">
        ${exerciseThumb(ex)}
      </button>
      <div class="exercise-row-main">
        <button class="exercise-link exercise-row-name" data-open-exercise="${ex.id}">${ex.name}</button>
        <div class="exercise-row-actions">
          ${done ? '<span class="badge good">✓ Hecho</span>' : `<button class="btn-ghost btn-sm" data-mark-done="${ex.id}">✓ Hecho</button>`}
        </div>
      </div>
    </div>
  `;
}

const DIFFICULTY_LEVEL = { principiante: 2, intermedio: 3, avanzado: 4 };
function levelBars(difficulty) {
  const level = DIFFICULTY_LEVEL[difficulty] || 3;
  const bars = Array.from({ length: 5 }, (_, i) => `<span class="level-bar ${i < level ? 'filled' : ''}"></span>`).join('');
  return `<span class="level-bars" title="Nivel ${level}/5">${bars}</span>`;
}

// ---------------------------------------------------------------------------
// Mini gráfico de evolución en SVG (sin dependencias externas)
// ---------------------------------------------------------------------------
function lineChart(points, { width = 560, height = 160, color = '#5b8def', unit = '' } = {}) {
  if (points.length < 2) {
    return `<p class="chart-empty">Añade al menos 2 mediciones para ver la evolución.</p>`;
  }
  const pad = 28;
  const xs = points.map((p) => p.x.getTime());
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;
  const sx = (t) => pad + ((t - minX) / (maxX - minX || 1)) * (width - pad * 2);
  const sy = (v) => height - pad - ((v - minY) / spanY) * (height - pad * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x.getTime()).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
  const dots = points
    .map((p) => `<circle cx="${sx(p.x.getTime()).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.5" fill="${color}"><title>${p.x.toLocaleDateString('es-ES')}: ${fmt1(p.y)}${unit}</title></circle>`)
    .join('');
  const first = points[0], last = points[points.length - 1];
  const delta = last.y - first.y;
  const deltaLabel = `${delta >= 0 ? '+' : ''}${fmt1(delta)}${unit} desde ${first.x.toLocaleDateString('es-ES')}`;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="xMidYMid meet">
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis" />
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" />
      ${dots}
    </svg>
    <p class="chart-delta">${deltaLabel}</p>
  `;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const root = $('#app');

function render() {
  root.dataset.ready = '1';
  if (window.__gymLoadTimeout) clearTimeout(window.__gymLoadTimeout);
  if (state.passwordRecovery) return renderPasswordReset();
  if (!state.session) return state.authMode === 'forgot' ? renderForgotPassword() : renderAuth();
  if (!state.profile) return renderOnboarding();
  return renderApp();
}

function renderAuth() {
  root.innerHTML = `
    <section class="auth-card">
      <h1>Rincón Fit</h1>
      <p class="lead">Tu rutina, tu dieta y tu evolución, a tu medida.</p>
      <div class="tabs-mini">
        <button class="tab-mini active" data-authtab="login">Entrar</button>
        <button class="tab-mini" data-authtab="signup">Crear cuenta</button>
      </div>
      <form id="auth-form" novalidate>
        <label>Email
          <input type="email" name="email" required autocomplete="email" />
        </label>
        <label>Contraseña
          <input type="password" name="password" required minlength="6" autocomplete="current-password" />
        </label>
        <label id="auth-password2-field" hidden>Repite la contraseña
          <input type="password" name="password2" minlength="6" autocomplete="new-password" />
        </label>
        <p class="field-error" id="auth-error" hidden></p>
        <button type="submit" class="btn-primary" id="auth-submit">Entrar</button>
      </form>
      <button type="button" class="link-btn" id="forgot-password-link">¿Has olvidado tu contraseña?</button>
    </section>
  `;
  let mode = 'login';
  $$('.tab-mini').forEach((btn) => btn.addEventListener('click', () => {
    mode = btn.dataset.authtab;
    $$('.tab-mini').forEach((b) => b.classList.toggle('active', b === btn));
    $('#auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
    $('#auth-form input[name=password]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    const password2Field = $('#auth-password2-field');
    password2Field.hidden = mode !== 'signup';
    password2Field.querySelector('input').required = mode === 'signup';
    $('#forgot-password-link').hidden = mode !== 'login';
  }));

  $('#forgot-password-link').addEventListener('click', () => {
    state.authMode = 'forgot';
    render();
  });

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').toString().trim();
    const password = fd.get('password').toString();
    const errorEl = $('#auth-error');
    errorEl.hidden = true;
    if (mode === 'signup' && password !== fd.get('password2').toString()) {
      errorEl.hidden = false;
      errorEl.classList.add('field-error');
      errorEl.classList.remove('field-ok');
      errorEl.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    $('#auth-submit').disabled = true;
    try {
      const { error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (mode === 'signup') {
        errorEl.hidden = false;
        errorEl.textContent = 'Cuenta creada. Si tu proyecto requiere confirmación, revisa tu email; si no, ya puedes entrar.';
        errorEl.classList.remove('field-error');
        errorEl.classList.add('field-ok');
      }
    } catch (err) {
      errorEl.hidden = false;
      errorEl.classList.add('field-error');
      errorEl.classList.remove('field-ok');
      errorEl.textContent = translateAuthError(err.message);
    } finally {
      $('#auth-submit').disabled = false;
    }
  });
}

function translateAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/already registered/i.test(msg)) return 'Ese email ya tiene una cuenta. Prueba a entrar.';
  if (/password/i.test(msg) && /6/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  return msg;
}

function renderForgotPassword() {
  root.innerHTML = `
    <section class="auth-card">
      <h1>Rincón Fit</h1>
      <p class="lead">Escribe tu email y te enviaremos un enlace para elegir una contraseña nueva.</p>
      <form id="forgot-form" novalidate>
        <label>Email
          <input type="email" name="email" required autocomplete="email" />
        </label>
        <p class="field-error" id="forgot-error" hidden></p>
        <button type="submit" class="btn-primary" id="forgot-submit">Enviar enlace</button>
      </form>
      <button type="button" class="link-btn" id="back-to-login-link">Volver a entrar</button>
    </section>
  `;
  $('#back-to-login-link').addEventListener('click', () => {
    state.authMode = null;
    render();
  });

  $('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').toString().trim();
    const errorEl = $('#forgot-error');
    errorEl.hidden = true;
    $('#forgot-submit').disabled = true;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      if (error) throw error;
      errorEl.hidden = false;
      errorEl.classList.remove('field-error');
      errorEl.classList.add('field-ok');
      errorEl.textContent = 'Si ese email tiene una cuenta, te hemos enviado un enlace para elegir una contraseña nueva. Revisa tu bandeja de entrada (y spam).';
    } catch (err) {
      errorEl.hidden = false;
      errorEl.classList.add('field-error');
      errorEl.classList.remove('field-ok');
      errorEl.textContent = translateAuthError(err.message);
    } finally {
      $('#forgot-submit').disabled = false;
    }
  });
}

function renderPasswordReset() {
  root.innerHTML = `
    <section class="auth-card">
      <h1>Rincón Fit</h1>
      <p class="lead">Elige tu nueva contraseña.</p>
      <form id="reset-form" novalidate>
        <label>Nueva contraseña
          <input type="password" name="password" required minlength="6" autocomplete="new-password" />
        </label>
        <label>Repite la nueva contraseña
          <input type="password" name="password2" required minlength="6" autocomplete="new-password" />
        </label>
        <p class="field-error" id="reset-error" hidden></p>
        <button type="submit" class="btn-primary" id="reset-submit">Guardar contraseña</button>
      </form>
    </section>
  `;

  $('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const password = fd.get('password').toString();
    const password2 = fd.get('password2').toString();
    const errorEl = $('#reset-error');
    errorEl.hidden = true;
    if (password !== password2) {
      errorEl.hidden = false;
      errorEl.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    $('#reset-submit').disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      state.passwordRecovery = false;
      history.replaceState(null, '', location.pathname);
      if (state.session) await loadUserData();
      render();
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = translateAuthError(err.message);
      $('#reset-submit').disabled = false;
    }
  });
}

function renderOnboarding() {
  root.innerHTML = `
    <section class="onboarding-card">
      <h1>Cuéntanos sobre ti</h1>
      <p class="lead">Con estos datos generamos tu rutina y tu dieta. Podrás cambiarlos cuando quieras en "Perfil".</p>
      <form id="onboarding-form">
        <label>Nombre
          <input type="text" name="full_name" required />
        </label>
        <fieldset>
          <legend>Sexo</legend>
          <label class="radio"><input type="radio" name="sex" value="mujer" required /> Mujer</label>
          <label class="radio"><input type="radio" name="sex" value="hombre" /> Hombre</label>
        </fieldset>
        <label>Fecha de nacimiento
          <input type="date" name="birth_date" required />
        </label>
        <label>Altura (cm)
          <input type="number" name="height_cm" min="100" max="250" step="0.1" required />
        </label>
        <label>Peso actual (kg)
          <input type="number" name="weight_kg" min="30" max="300" step="0.1" required />
        </label>
        <label>Nivel de actividad
          <select name="activity_level" required>
            ${Object.entries(ACTIVITY_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <fieldset>
          <legend>Objetivo</legend>
          ${Object.entries(GOAL_LABELS).map(([v, l]) => `
            <label class="radio"><input type="radio" name="goal" value="${v}" ${v === 'definicion' ? 'checked' : ''} /> ${l}</label>
          `).join('')}
        </fieldset>
        <label>Días de entrenamiento por semana
          <select name="days_per_week">
            ${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n} días</option>`).join('')}
          </select>
        </label>
        ${injuriesFieldsetHTML([])}
        <p class="field-error" id="onboarding-error" hidden></p>
        <button type="submit" class="btn-primary">Empezar</button>
      </form>
    </section>
  `;

  $('#onboarding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errorEl = $('#onboarding-error');
    errorEl.hidden = true;
    const userId = state.session.user.id;
    const profilePayload = {
      id: userId,
      full_name: fd.get('full_name').toString().trim(),
      sex: fd.get('sex'),
      birth_date: fd.get('birth_date'),
      height_cm: Number(fd.get('height_cm')),
      activity_level: fd.get('activity_level'),
      goal: fd.get('goal'),
      days_per_week: Number(fd.get('days_per_week')),
      injuries: fd.getAll('injuries'),
    };
    const weightKg = Number(fd.get('weight_kg'));
    try {
      const { error: profileError } = await supabase.from('gym_profiles').upsert(profilePayload);
      if (profileError) throw profileError;
      const { error: measurementError } = await supabase.from('gym_measurements').upsert(
        { user_id: userId, measured_at: todayISO(), weight_kg: weightKg },
        { onConflict: 'user_id,measured_at' }
      );
      if (measurementError) throw measurementError;
      await loadUserData();
      render();
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err.message;
    }
  });
}

function latestMeasurement() {
  return state.measurements[state.measurements.length - 1] || null;
}

const NAV_TABS = ['resumen', 'rutina', 'dieta', 'medidas', 'calendario', 'perfil'];

function renderApp() {
  const p = state.profile;
  const tabs = isAdmin() ? NAV_TABS.concat('admin') : NAV_TABS;
  root.innerHTML = `
    <header class="app-header">
      <div class="brand"><span class="brand-mark" aria-hidden="true">🏋️</span> Rincón Fit</div>
    </header>
    <nav class="bottom-nav" aria-label="Navegación principal">
      ${tabs.map((t) => `
        <button class="tab ${state.tab === t ? 'active' : ''}" data-tab="${t}">
          <span class="tab-icon" aria-hidden="true">${tabIcon(t)}</span>
          <span class="tab-label">${tabLabel(t)}</span>
        </button>
      `).join('')}
    </nav>
    <main class="app-main" id="app-main"></main>
  `;
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.tab === state.tab) return;
    goToTab(btn.dataset.tab);
  }));
  const main = $('#app-main');
  if (state.tab === 'resumen') main.innerHTML = viewResumen();
  else if (state.tab === 'rutina') main.innerHTML = viewRutina();
  else if (state.tab === 'dieta') main.innerHTML = viewDieta();
  else if (state.tab === 'medidas') main.innerHTML = viewMedidas();
  else if (state.tab === 'perfil') main.innerHTML = viewPerfil();
  else if (state.tab === 'ejercicio') main.innerHTML = viewExerciseDetail();
  else if (state.tab === 'calendario') main.innerHTML = viewCalendario();
  else if (state.tab === 'admin') main.innerHTML = viewAdmin();

  wireTabEvents();
}

function tabLabel(t) {
  return { resumen: 'Resumen', rutina: 'Rutina', dieta: 'Dieta', medidas: 'Medidas', calendario: 'Calendario', perfil: 'Perfil', admin: 'Admin' }[t];
}

function tabIcon(t) {
  return { resumen: '🏠', rutina: '🏋️', dieta: '🥗', medidas: '📏', calendario: '📅', perfil: '👤', admin: '📊' }[t];
}

function viewAdmin() {
  if (!isAdmin()) {
    return `<section class="panel"><p class="muted">No tienes acceso a esta sección.</p></section>`;
  }
  if (state.adminLoading) {
    return `<section class="panel"><p class="muted">Cargando estadísticas…</p></section>`;
  }
  if (state.adminError) {
    return `<section class="panel"><p class="field-error">${state.adminError}</p></section>`;
  }
  const stats = state.adminStats;
  if (!stats) return `<section class="panel"><p class="muted">Sin datos.</p></section>`;

  return `
    <section class="panel">
      <h2>Panel de administración</h2>
      <p class="muted">Usuarios que han completado el cuestionario inicial de Rincón Fit (solo visible para ti).</p>
      <div class="card-grid">
        <div class="stat-card">
          <span class="stat-label">Usuarios totales</span>
          <span class="stat-value">${stats.total_users}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Nuevos últimos 7 días</span>
          <span class="stat-value">${stats.last_7_days}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Nuevos últimos 30 días</span>
          <span class="stat-value">${stats.last_30_days}</span>
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>Últimas altas</h2>
      ${stats.signups.length === 0 ? '<p class="chart-empty">Todavía no hay usuarios registrados.</p>' : `
      <div class="table-scroll">
      <table class="routine-table">
        <thead><tr><th>Nombre</th><th>Objetivo</th><th>Días/semana</th><th>Alta</th></tr></thead>
        <tbody>
          ${stats.signups.map((s) => `
            <tr>
              <td>${s.full_name || '—'}</td>
              <td>${GOAL_LABELS[s.goal] || s.goal || '—'}</td>
              <td>${s.days_per_week ?? '—'}</td>
              <td>${s.created_at ? new Date(s.created_at).toLocaleDateString('es-ES') : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
      `}
    </section>
  `;
}

async function loadAdminStats() {
  state.tab = 'admin';
  state.adminLoading = true;
  state.adminError = null;
  render();
  const { data, error } = await supabase.rpc('gym_admin_stats');
  if (error) {
    state.adminError = 'No se pudieron cargar las estadísticas: ' + error.message;
    state.adminStats = null;
  } else {
    state.adminStats = data;
  }
  state.adminLoading = false;
  render();
}

function viewResumen() {
  const p = state.profile;
  const m = latestMeasurement();
  const bmiVal = m ? bmi(m.weight_kg, p.height_cm) : null;
  const bmiCat = bmiCategory(bmiVal);
  const waist = m ? waistRisk(m.waist_cm, p.sex) : null;
  const weightPoints = state.measurements.filter((x) => x.weight_kg != null).map((x) => ({ x: new Date(x.measured_at), y: Number(x.weight_kg) }));

  return `
    <section class="card-grid">
      <div class="stat-card">
        <span class="stat-label">Peso actual</span>
        <span class="stat-value">${m ? fmt1(m.weight_kg) + ' kg' : 'Sin datos'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">IMC</span>
        <span class="stat-value">${bmiVal ? fmt1(bmiVal) : '—'}</span>
        <span class="badge ${bmiCat.tone}">${bmiCat.label}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Cintura</span>
        <span class="stat-value">${m && m.waist_cm ? fmt1(m.waist_cm) + ' cm' : '—'}</span>
        ${waist ? `<span class="badge ${waist.tone}">${waist.label}</span>` : ''}
      </div>
      <div class="stat-card">
        <span class="stat-label">Objetivo</span>
        <span class="stat-value stat-value-sm">${GOAL_LABELS[p.goal]}</span>
      </div>
    </section>
    <section class="panel">
      <h2>Evolución del peso</h2>
      ${lineChart(weightPoints, { color: '#5b8def', unit: ' kg' })}
    </section>
    <section class="panel">
      <h2>Hola, ${p.full_name || ''}</h2>
      <p>Sexo: ${p.sex === 'mujer' ? 'Mujer' : 'Hombre'} · Altura: ${fmt1(p.height_cm)} cm · Actividad: ${ACTIVITY_LABELS[p.activity_level]}</p>
      <p>Entrena ${p.days_per_week} días/semana. Ve a la pestaña <strong>Rutina</strong> y <strong>Dieta</strong> para ver tu plan de hoy.</p>
    </section>
  `;
}

function isDoneToday(exerciseId) {
  const today = todayISO();
  return state.allExerciseLogs.some((l) => l.exercise_id === exerciseId && l.logged_at === today);
}

// Registra una serie de hoy sin peso/reps (para el botón "Hecho hoy" de la
// rutina y para añadir a mano un ejercicio que no estaba planificado).
// Devuelve true si se guardó bien.
async function markExerciseDoneToday(exerciseId) {
  const payload = {
    user_id: state.session.user.id,
    exercise_id: exerciseId,
    logged_at: todayISO(),
    weight_kg: null,
    reps: null,
    sets: 1,
  };
  const { error } = await supabase.from('gym_exercise_logs').insert(payload);
  if (error) {
    alert('No se pudo guardar: ' + error.message);
    return false;
  }
  // Recarga desde el servidor (en vez de usar un id local inventado) para
  // que el botón "Quitar" pueda borrar la fila real que se acaba de crear.
  await refreshAllExerciseLogs();
  if (state.selectedExerciseId === exerciseId) {
    await reloadExerciseLogs();
  }
  render();
  return true;
}

async function refreshAllExerciseLogs() {
  const userId = state.session.user.id;
  const { data } = await supabase
    .from('gym_exercise_logs')
    .select('*')
    .eq('user_id', userId)
    .order('logged_at', { ascending: true });
  state.allExerciseLogs = data || [];
}

function viewRutina() {
  const p = state.profile;
  const vol = GOAL_VOLUME[p.goal];
  const injuries = p.injuries || [];
  const weekdayPlan = weekdayPlanFor(p);
  const baseDaysCount = (SPLITS[p.days_per_week] || SPLITS[3]).length;
  const extraDaysCount = extraDaysCountFor(weekdayPlan, baseDaysCount);
  const routine = applyRoutineOverrides(generateRoutine(p, state.exercises, currentRoutineSeed(), extraDaysCount));
  const weekdaysForRoutineDay = weekdaysByRoutineDay(weekdayPlan, routine.length);
  const todayWd = todayWeekdayIndex();
  const todayRoutineIndex = weekdayPlan[todayWd];
  const dayIndex = state.selectedRoutineDay !== null ? state.selectedRoutineDay : (todayRoutineIndex !== null ? todayRoutineIndex : 0);
  const day = routine[dayIndex];

  const plannedIds = new Set(day.exercises.map((ex) => ex.id));
  const stretchIds = new Set(state.exercises.filter((e) => e.muscle_group === 'estiramiento').map((e) => e.id));
  const today = todayISO();
  const extraLogsToday = state.allExerciseLogs.filter((l) => l.logged_at === today && !plannedIds.has(l.exercise_id) && !stretchIds.has(l.exercise_id));
  const extraExerciseIdsToday = [...new Set(extraLogsToday.map((l) => l.exercise_id))];
  const availableExtra = state.exercises
    .filter((e) => !plannedIds.has(e.id) && !extraExerciseIdsToday.includes(e.id) && e.muscle_group !== 'estiramiento')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const stretches = state.exercises.filter((e) => e.muscle_group === 'estiramiento');
  const stretchesBefore = stretches.filter((e) => e.stretch_timing === 'antes' || e.stretch_timing === 'ambos');
  const stretchesAfter = stretches.filter((e) => e.stretch_timing === 'despues' || e.stretch_timing === 'ambos');

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Rutina — ${GOAL_LABELS[p.goal]}</h2>
        <button class="btn-secondary" id="regen-routine">Generar otra variante</button>
      </div>
      <p>Pauta general: <strong>${vol.sets} series</strong> de <strong>${vol.reps} repeticiones</strong>, descanso de <strong>${vol.rest}</strong> entre series. Ajusta el peso para que las últimas 2 repeticiones cuesten de verdad sin perder la técnica.</p>
      <p class="muted">Cada semana se renuevan los ejercicios automáticamente (el grupo muscular del día puede repetirse, pero se evitan en lo posible los mismos ejercicios de la semana pasada). "Generar otra variante" hace lo mismo al momento, dentro de esta semana.</p>
      <p class="muted">¿No tienes alguna de estas máquinas en tu gimnasio? Pulsa "Cambiar" para sustituirla por otra del mismo grupo muscular.</p>
      ${injuries.length > 0 ? `<p class="muted">⚠️ Evitando en lo posible ejercicios de riesgo para: <strong>${injuries.map((i) => INJURY_LABELS[i] || i).join(', ')}</strong>. Cambia esto en <strong>Perfil</strong>.</p>` : ''}

      <div class="routine-day-tabs">
        ${routine.map((d, i) => {
          const wds = weekdaysForRoutineDay[i];
          const isToday = i === todayRoutineIndex;
          const label = wds.length ? wds.map((wd) => WEEKDAY_NAMES[wd]).join(' y ') : `Día ${i + 1} (sin día fijo)`;
          return `<button class="day-pill ${i === dayIndex ? 'active' : ''}" data-routine-day="${i}">${label}${isToday ? ' · hoy' : ''}</button>`;
        }).join('')}
      </div>
      ${todayRoutineIndex === null ? '<p class="muted">Hoy no tienes entrenamiento asignado en tu rutina (día de descanso). Puedes consultar cualquier otro día arriba, o "Editar mis días" si has venido igualmente.</p>' : ''}

      <div class="weekday-plan-toggle">
        <button type="button" class="btn-ghost btn-sm" id="toggle-weekday-plan">${state.editingWeekdayPlan ? 'Cancelar' : '✏️ Editar mis días de esta semana'}</button>
      </div>
      ${state.editingWeekdayPlan ? `
      <form id="weekday-plan-form" class="weekday-plan-form">
        <p class="muted">Elige qué entrenamiento (o descanso) toca cada día de la semana. Puedes repetir uno ya existente, añadir un "Día nuevo" con ejercicios distintos, cambiar uno de sitio (p. ej. mover el jueves al miércoles), o marcar más o menos días de los habituales. Esto no cambia tu configuración de días/semana en Perfil, solo el reparto de esta rutina.</p>
        ${WEEKDAY_NAMES.map((name, wd) => `
          <label class="weekday-plan-row">
            <span>${name}</span>
            <select name="wd-${wd}">
              <option value="" ${weekdayPlan[wd] === null ? 'selected' : ''}>Descanso</option>
              ${routine.map((d, i) => `<option value="${i}" ${weekdayPlan[wd] === i ? 'selected' : ''}>${d.label}</option>`).join('')}
              <option value="new">➕ Día nuevo (genera ejercicios distintos)</option>
            </select>
          </label>
        `).join('')}
        <div class="weekday-plan-actions">
          <button type="submit" class="btn-primary">Guardar días</button>
          <button type="button" class="btn-secondary" id="reset-weekday-plan">Restablecer automático</button>
        </div>
      </form>
      ` : ''}

      <div class="routine-day">
        <h3>${day.label}</h3>
        ${day.exercises.length === 0 ? '<p class="chart-empty">No hay ejercicios suficientes en el catálogo para este grupo.</p>' : `
        ${day.exercises.length < 6 && injuries.length > 0 ? '<p class="muted">Hoy salen menos ejercicios de lo habitual: hay pocas alternativas seguras para tu lesión en este grupo muscular.</p>' : ''}
        <div class="exercise-row-list">
          ${day.exercises.map((ex, slotIndex) => {
            const done = isDoneToday(ex.id);
            return `
              <div class="exercise-row">
                <button class="exercise-row-thumb" data-open-exercise="${ex.id}" aria-label="Ver detalle de ${ex.name}">
                  ${exerciseThumb(ex)}
                </button>
                <div class="exercise-row-main">
                  <button class="exercise-link exercise-row-name" data-open-exercise="${ex.id}">${ex.name}</button>
                  <div class="exercise-row-meta">
                    ${levelBars(ex.difficulty)}
                    <span>${ex.muscle_group === 'cardio' ? 'Velocidad y tiempo' : `${vol.sets} x ${vol.reps}`}</span>
                  </div>
                  ${!isSafeForInjuries(ex, injuries) ? '<span class="badge warn">⚠️ revisa tu lesión</span>' : ''}
                  <div class="exercise-row-actions">
                    <button class="btn-ghost btn-sm" data-swap-day="${dayIndex}" data-swap-slot="${slotIndex}" data-swap-exercise="${ex.id}">🔁 Cambiar</button>
                    ${done
                      ? '<span class="badge good">✓ Hecho hoy</span>'
                      : `<button class="btn-ghost btn-sm" data-mark-done="${ex.id}">✓ Hecho hoy</button>`}
                  </div>
                </div>
                ${bodyDiagramMini(ex.muscle_group)}
              </div>
            `;
          }).join('')}
        </div>`}
      </div>

      ${stretches.length > 0 ? `
      <div class="routine-day">
        <details class="stretch-section" id="stretch-section" ${state.stretchSectionOpen ? 'open' : ''}>
          <summary class="stretch-summary">🧘 Estiramientos <span class="muted">(opcional)</span></summary>
          <p class="muted">No cuentan para tu rutina ni hace falta hacerlos: es solo una ayuda para calentar antes y soltar músculo después.</p>
          ${stretchesBefore.length > 0 ? `
            <h4>Antes de entrenar</h4>
            <div class="exercise-row-list">${stretchesBefore.map(stretchRowHTML).join('')}</div>
          ` : ''}
          ${stretchesAfter.length > 0 ? `
            <h4>Después de entrenar</h4>
            <div class="exercise-row-list">${stretchesAfter.map(stretchRowHTML).join('')}</div>
          ` : ''}
        </details>
      </div>` : ''}

      ${extraExerciseIdsToday.length > 0 ? `
      <div class="routine-day">
        <h3>Otros ejercicios que has hecho hoy</h3>
        <p class="muted">No estaban en la rutina de hoy, pero quedan registrados igualmente.</p>
        <table class="routine-table">
          <thead><tr><th>Ejercicio</th><th></th></tr></thead>
          <tbody>
            ${extraExerciseIdsToday.map((exId) => {
              const ex = state.exercises.find((e) => e.id === exId);
              const log = extraLogsToday.find((l) => l.exercise_id === exId);
              return `
                <tr>
                  <td>
                    <button class="exercise-link" data-open-exercise="${exId}">${ex ? ex.name : 'Ejercicio'}</button>
                    <span class="badge good">✓ Hecho hoy</span>
                  </td>
                  <td><button class="btn-ghost btn-sm" data-remove-extra-log="${log.id}">Quitar</button></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <div class="routine-day">
        <h3>¿Has hecho algún ejercicio más hoy?</h3>
        <p class="muted">Si has usado alguna máquina o ejercicio que no estaba en tu rutina de hoy, añádelo aquí para que quede en tu registro y en el calendario.</p>
        ${availableExtra.length === 0 ? '<p class="chart-empty">Ya está todo el catálogo registrado hoy.</p>' : `
        <div class="extra-exercise-row">
          <select id="extra-exercise-select">
            ${availableExtra.map((e) => `<option value="${e.id}">${e.name} (${MUSCLE_LABELS[e.muscle_group]})</option>`).join('')}
          </select>
          <button class="btn-secondary btn-sm" id="add-extra-exercise">✓ Marcar como hecho</button>
        </div>`}
      </div>
    </section>
  `;
}

function viewDieta() {
  const p = state.profile;
  const m = latestMeasurement();
  const targets = m ? dietTargets(p, Number(m.weight_kg)) : null;
  if (!targets) {
    return `<section class="panel"><p>Registra tu peso en la pestaña <strong>Medidas</strong> para calcular tu dieta.</p></section>`;
  }
  const goalNote = {
    perdida_peso: 'Déficit moderado (~500 kcal/día) para perder grasa sin perder demasiado músculo. Prioriza proteína y verdura en cada comida.',
    definicion: 'Déficit ligero (~250 kcal/día) manteniendo proteína alta para conservar la masa muscular mientras bajas grasa corporal.',
    volumen: 'Superávit moderado (~300 kcal/día) para ganar masa muscular minimizando la grasa acumulada.',
  }[p.goal];

  return `
    <section class="panel">
      <h2>Dieta orientativa — ${GOAL_LABELS[p.goal]}</h2>
      <p class="muted">Calculada con la fórmula de Mifflin-St Jeor (específica por sexo) a partir de tu peso, altura, edad y nivel de actividad. Es una estimación de partida: ajusta según tu evolución real.</p>
      <div class="card-grid">
        <div class="stat-card"><span class="stat-label">Calorías/día</span><span class="stat-value">${fmt0(targets.calories)} kcal</span></div>
        <div class="stat-card"><span class="stat-label">Proteína</span><span class="stat-value">${fmt0(targets.proteinG)} g</span></div>
        <div class="stat-card"><span class="stat-label">Grasas</span><span class="stat-value">${fmt0(targets.fatG)} g</span></div>
        <div class="stat-card"><span class="stat-label">Carbohidratos</span><span class="stat-value">${fmt0(targets.carbsG)} g</span></div>
      </div>
      <p>${goalNote}</p>
      <h3>Qué comer en cada comida</h3>
      <p class="muted">Cantidades en crudo/cocido según el alimento, calculadas para cubrir tus macros de hoy. Puedes cambiar un alimento por otro de la misma categoría (p. ej. pollo por pavo, arroz por pasta) manteniendo un peso parecido.</p>
      ${MEAL_TEMPLATES.map((template) => {
        const items = mealFoodPlan(targets, template);
        const mealKcal = Math.round(targets.calories * template.pct);
        return `
          <div class="routine-day">
            <h4>${template.label} <span class="muted">— ${Math.round(template.pct * 100)}% · ~${mealKcal} kcal</span></h4>
            <table class="routine-table">
              <thead><tr><th>Alimento</th><th>Cantidad</th><th>Aprox. kcal</th></tr></thead>
              <tbody>
                ${items.map((it) => `<tr><td>${it.name}</td><td>${it.grams} g</td><td>${it.kcal} kcal</td></tr>`).join('')}
                ${template.extra ? `<tr><td colspan="3" class="muted">${template.extra}</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        `;
      }).join('')}
      <p class="muted">Este cálculo es orientativo (usa valores nutricionales medios) y no sustituye a un/a nutricionista si tienes alguna condición médica. Puedes sustituir cualquier alimento por otro de su misma categoría (proteína/carbohidrato/grasa) con un peso similar.</p>
    </section>

    <section class="panel">
      <h2>Suplementos recomendados</h2>
      <p class="muted">${SUPPLEMENT_GOAL_NOTES[p.goal]}</p>
      <div class="table-scroll">
      <table class="routine-table">
        <thead><tr><th>Suplemento</th><th>Dosis orientativa</th><th>Para qué</th></tr></thead>
        <tbody>
          ${SUPPLEMENTS.map((s) => `<tr><td>${s.name}</td><td>${s.dose}</td><td>${s.note}</td></tr>`).join('')}
        </tbody>
      </table>
      </div>
      <p class="muted">Son recomendaciones generales, no sustituyen el consejo de un médico o nutricionista, sobre todo si tomas medicación, estás embarazada o en periodo de lactancia, o tienes alguna condición renal, hepática o cardiaca (la creatina y otros suplementos no son adecuados en esos casos). Los suplementos complementan una dieta ya cuidada, nunca la sustituyen.</p>
    </section>
  `;
}

function viewMedidas() {
  const p = state.profile;
  const rows = state.measurements.slice().reverse();
  const wPoints = state.measurements.filter((x) => x.waist_cm != null).map((x) => ({ x: new Date(x.measured_at), y: Number(x.waist_cm) }));
  const abdomenPoints = state.measurements.filter((x) => x.upper_abdomen_cm != null).map((x) => ({ x: new Date(x.measured_at), y: Number(x.upper_abdomen_cm) }));
  const bmiPoints = state.measurements
    .filter((x) => x.weight_kg != null)
    .map((x) => ({ x: new Date(x.measured_at), y: bmi(Number(x.weight_kg), p.height_cm) }));

  return `
    <section class="panel">
      <h2>Nueva medición</h2>
      <form id="measure-form" class="measure-form">
        <label>Fecha <input type="date" name="measured_at" value="${todayISO()}" max="${todayISO()}" required /></label>
        <label>Peso (kg) <input type="number" name="weight_kg" step="0.1" min="30" max="400" /></label>
        <label>Cintura (cm) <input type="number" name="waist_cm" step="0.1" min="30" max="300" /></label>
        <label>Tripa, encima del ombligo (cm) <input type="number" name="upper_abdomen_cm" step="0.1" min="30" max="300" /></label>
        <label>Pecho (cm) <input type="number" name="chest_cm" step="0.1" min="30" max="300" /></label>
        <label>Brazo (cm) <input type="number" name="arm_cm" step="0.1" min="10" max="100" /></label>
        <label>Pierna (cm) <input type="number" name="leg_cm" step="0.1" min="20" max="150" /></label>
        <label class="full">Notas <input type="text" name="notes" maxlength="200" /></label>
        <p class="field-error" id="measure-error" hidden></p>
        <button type="submit" class="btn-primary">Guardar medición</button>
      </form>
    </section>
    <section class="panel">
      <h2>Evolución</h2>
      <h3>Cintura</h3>
      ${lineChart(wPoints, { color: '#e08e45', unit: ' cm' })}
      <h3>Tripa (encima del ombligo)</h3>
      ${lineChart(abdomenPoints, { color: '#c98bd8', unit: ' cm' })}
      <h3>IMC</h3>
      ${lineChart(bmiPoints, { color: '#7bb661', unit: '' })}
    </section>
    <section class="panel">
      <h2>Histórico</h2>
      ${rows.length === 0 ? '<p class="chart-empty">Todavía no hay mediciones.</p>' : `
      <div class="table-scroll">
      <table class="routine-table">
        <thead><tr><th>Fecha</th><th>Peso</th><th>Cintura</th><th>Tripa</th><th>Pecho</th><th>Brazo</th><th>Pierna</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${new Date(r.measured_at).toLocaleDateString('es-ES')}</td>
              <td>${fmt1(r.weight_kg)}</td>
              <td>${fmt1(r.waist_cm)}</td>
              <td>${fmt1(r.upper_abdomen_cm)}</td>
              <td>${fmt1(r.chest_cm)}</td>
              <td>${fmt1(r.arm_cm)}</td>
              <td>${fmt1(r.leg_cm)}</td>
              <td><button class="btn-ghost btn-sm" data-delete-measure="${r.id}">Borrar</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`}
    </section>
  `;
}

function viewExerciseDetail() {
  const ex = state.exercises.find((e) => e.id === state.selectedExerciseId);
  if (!ex) {
    return `<section class="panel"><button class="btn-ghost" data-back-to-rutina>← Volver a la rutina</button><p>Ejercicio no encontrado.</p></section>`;
  }
  if (state.exerciseDetailLoading) {
    return `
      <section class="panel">
        <button class="btn-ghost" data-back-to-rutina>← Volver a la rutina</button>
        <p class="muted">Cargando…</p>
      </section>
    `;
  }

  const logs = state.exerciseLogs;
  const isCardio = ex.muscle_group === 'cardio';
  // Ejercicios (y estiramientos) que se hacen solo con el propio peso
  // corporal: no tiene sentido pedir un peso añadido, solo repeticiones.
  const tracksWeight = !isCardio && ex.logs_weight !== false;
  const isBodyweight = !isCardio && !tracksWeight;
  const last30 = logs.filter((l) => (Date.now() - new Date(l.logged_at + 'T00:00:00')) / 86400000 <= 30);

  // Los ejercicios de cardio (cinta, bici...) no se miden en peso/reps sino
  // en velocidad y tiempo, así que llevan sus propias estadísticas y su
  // propio formulario de registro.
  const maxSpeed = logs.reduce((m, l) => (l.speed_kmh != null ? Math.max(m, Number(l.speed_kmh)) : m), 0);
  const minutes30 = last30.reduce((s, l) => s + (Number(l.duration_min) || 0), 0);

  const maxWeight = logs.reduce((m, l) => (l.weight_kg != null ? Math.max(m, Number(l.weight_kg)) : m), 0);
  const volume30 = last30.reduce((s, l) => s + (Number(l.weight_kg) || 0) * (Number(l.reps) || 0) * (Number(l.sets) || 1), 0);
  const est1RM = logs.reduce((m, l) => {
    if (l.weight_kg == null || l.reps == null) return m;
    return Math.max(m, Number(l.weight_kg) * (1 + Number(l.reps) / 30));
  }, 0);

  // Para ejercicios de solo peso corporal, el progreso se mide en
  // repeticiones en vez de en kg.
  const maxReps = logs.reduce((m, l) => (l.reps != null ? Math.max(m, Number(l.reps)) : m), 0);
  const totalReps30 = last30.reduce((s, l) => s + (Number(l.reps) || 0) * (Number(l.sets) || 1), 0);

  const byDay = {};
  logs.forEach((l) => {
    const value = isCardio ? l.speed_kmh : isBodyweight ? l.reps : l.weight_kg;
    if (value == null) return;
    byDay[l.logged_at] = Math.max(byDay[l.logged_at] || 0, Number(value));
  });
  const chartPoints = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, w]) => ({ x: new Date(d + 'T00:00:00'), y: w }));

  const videoQuery = encodeURIComponent(`${ex.name} ${ex.machine} técnica ejecución`);
  const goal = state.profile ? state.profile.goal : 'definicion';
  const defaultSets = GOAL_VOLUME[goal].sets;

  const injuries = state.profile.injuries || [];
  const riskyZones = (ex.caution_for || []).filter((z) => injuries.includes(z));

  return `
    <section class="panel exercise-detail">
      <button class="btn-ghost" data-back-to-rutina>← Volver a la rutina</button>
      <div class="exercise-detail-head">
        <div>
          <h2>${ex.name}</h2>
          <p class="muted">${ex.machine} · ${MUSCLE_LABELS[ex.muscle_group]}</p>
          ${levelBars(ex.difficulty)}
        </div>
        <div class="exercise-visuals">
          ${exercisePhotoLoop(ex.photo_ref, ex.name) || movementAnimation(ex.movement_type)}
          ${bodyDiagram(ex.muscle_group)}
        </div>
      </div>
      ${riskyZones.length > 0 ? `<div class="tip-box warn-box">⚠️ <strong>Puede no ser adecuado para tu lesión de ${riskyZones.map((z) => INJURY_LABELS[z] || z).join(' / ')}.</strong> Prueba una alternativa del mismo grupo muscular o consulta a un fisioterapeuta antes de hacerlo.</div>` : ''}
      ${ex.photo_ref ? '<p class="muted photo-credit">Fotos: banco de imágenes de dominio público (Free Exercise DB).</p>' : ''}
      <a class="btn-secondary" href="https://www.youtube.com/results?search_query=${videoQuery}" target="_blank" rel="noopener">▶ Buscar demostración en vídeo</a>

      <h3>Cómo hacerlo</h3>
      <ol class="steps-list">
        ${(ex.steps && ex.steps.length ? ex.steps : [ex.instructions]).map((s) => `<li>${s}</li>`).join('')}
      </ol>

      ${ex.tip ? `<div class="tip-box">💡 <strong>Consejo de experto:</strong> ${ex.tip}</div>` : ''}

      <h3>Tu nota personal</h3>
      <textarea id="exercise-note" rows="2" placeholder="Apunta aquí lo que te funcione (peso, sensaciones, ajustes de máquina...)">${state.exerciseNote || ''}</textarea>
      <p class="field-ok" id="note-ok" hidden>Guardado.</p>

      <h3>Tu progreso</h3>
      ${isCardio ? `
      <div class="card-grid">
        <div class="stat-card"><span class="stat-label">Velocidad máxima</span><span class="stat-value">${maxSpeed ? fmt1(maxSpeed) + ' km/h' : '—'}</span></div>
        <div class="stat-card"><span class="stat-label">Minutos (30 días)</span><span class="stat-value">${minutes30 ? fmt0(minutes30) + ' min' : '—'}</span></div>
        <div class="stat-card"><span class="stat-label">Sesiones registradas</span><span class="stat-value">${logs.length || '—'}</span></div>
      </div>
      ${chartPoints.length >= 2 ? lineChart(chartPoints, { color: '#5b8def', unit: ' km/h' }) : '<p class="chart-empty">Registra al menos 2 sesiones para ver tu evolución de velocidad.</p>'}

      <h3>Registrar sesión de hoy</h3>
      <form id="log-form" class="measure-form">
        <label>Fecha <input type="date" name="logged_at" value="${todayISO()}" max="${todayISO()}" required /></label>
        <label>Velocidad (km/h) <input type="number" name="speed_kmh" step="0.1" min="0" max="40" /></label>
        <label>Duración (min) <input type="number" name="duration_min" step="1" min="0" max="600" /></label>
        <p class="field-error" id="log-error" hidden></p>
        <button type="submit" class="btn-primary">Guardar</button>
      </form>

      ${logs.length ? `
      <div class="table-scroll">
      <table class="routine-table">
        <thead><tr><th>Fecha</th><th>Velocidad</th><th>Duración</th><th></th></tr></thead>
        <tbody>
          ${logs.slice().reverse().slice(0, 10).map((l) => `
            <tr>
              <td>${new Date(l.logged_at + 'T00:00:00').toLocaleDateString('es-ES')}</td>
              <td>${l.speed_kmh != null ? fmt1(l.speed_kmh) + ' km/h' : '—'}</td>
              <td>${l.duration_min != null ? fmt0(l.duration_min) + ' min' : '—'}</td>
              <td><button class="btn-ghost btn-sm" data-delete-log="${l.id}">Borrar</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>` : ''}
      ` : isBodyweight ? `
      <div class="card-grid">
        <div class="stat-card"><span class="stat-label">Repeticiones máximas</span><span class="stat-value">${maxReps || '—'}</span></div>
        <div class="stat-card"><span class="stat-label">Repeticiones (30 días)</span><span class="stat-value">${totalReps30 || '—'}</span></div>
        <div class="stat-card"><span class="stat-label">Sesiones registradas</span><span class="stat-value">${logs.length || '—'}</span></div>
      </div>
      ${chartPoints.length >= 2 ? lineChart(chartPoints, { color: '#5b8def', unit: ' reps' }) : '<p class="chart-empty">Registra al menos 2 sesiones para ver tu evolución de repeticiones.</p>'}

      <h3>Registrar serie de hoy</h3>
      <p class="muted">Ejercicio con tu propio peso corporal: solo hace falta apuntar las repeticiones.</p>
      <form id="log-form" class="measure-form">
        <label>Fecha <input type="date" name="logged_at" value="${todayISO()}" max="${todayISO()}" required /></label>
        <label>Repeticiones <input type="number" name="reps" min="0" max="199" /></label>
        <label>Series <input type="number" name="sets" min="1" max="49" value="${defaultSets}" /></label>
        <p class="field-error" id="log-error" hidden></p>
        <button type="submit" class="btn-primary">Guardar</button>
      </form>

      ${logs.length ? `
      <div class="table-scroll">
      <table class="routine-table">
        <thead><tr><th>Fecha</th><th>Reps</th><th>Series</th><th></th></tr></thead>
        <tbody>
          ${logs.slice().reverse().slice(0, 10).map((l) => `
            <tr>
              <td>${new Date(l.logged_at + 'T00:00:00').toLocaleDateString('es-ES')}</td>
              <td>${l.reps ?? '—'}</td>
              <td>${l.sets}</td>
              <td><button class="btn-ghost btn-sm" data-delete-log="${l.id}">Borrar</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>` : ''}
      ` : `
      <div class="card-grid">
        <div class="stat-card"><span class="stat-label">Peso máximo</span><span class="stat-value">${maxWeight ? fmt1(maxWeight) + ' kg' : '—'}</span></div>
        <div class="stat-card"><span class="stat-label">Volumen (30 días)</span><span class="stat-value">${volume30 ? fmt0(volume30) + ' kg' : '—'}</span></div>
        <div class="stat-card"><span class="stat-label">1RM estimado</span><span class="stat-value">${est1RM ? fmt1(est1RM) + ' kg' : '—'}</span></div>
      </div>
      ${chartPoints.length >= 2 ? lineChart(chartPoints, { color: '#5b8def', unit: ' kg' }) : '<p class="chart-empty">Registra al menos 2 sesiones con peso para ver tu evolución.</p>'}

      <h3>Registrar serie de hoy</h3>
      <form id="log-form" class="measure-form">
        <label>Fecha <input type="date" name="logged_at" value="${todayISO()}" max="${todayISO()}" required /></label>
        <label>Peso (kg) <input type="number" name="weight_kg" step="0.5" min="0" max="500" /></label>
        <label>Repeticiones <input type="number" name="reps" min="0" max="199" /></label>
        <label>Series <input type="number" name="sets" min="1" max="49" value="${defaultSets}" /></label>
        <p class="field-error" id="log-error" hidden></p>
        <button type="submit" class="btn-primary">Guardar</button>
      </form>

      ${logs.length ? `
      <div class="table-scroll">
      <table class="routine-table">
        <thead><tr><th>Fecha</th><th>Peso</th><th>Reps</th><th>Series</th><th></th></tr></thead>
        <tbody>
          ${logs.slice().reverse().slice(0, 10).map((l) => `
            <tr>
              <td>${new Date(l.logged_at + 'T00:00:00').toLocaleDateString('es-ES')}</td>
              <td>${fmt1(l.weight_kg)}</td>
              <td>${l.reps ?? '—'}</td>
              <td>${l.sets}</td>
              <td><button class="btn-ghost btn-sm" data-delete-log="${l.id}">Borrar</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>` : ''}
      `}
    </section>
  `;
}

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function dateToISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayHasActivity(dateStr) {
  return state.measurements.some((m) => m.measured_at === dateStr)
    || state.allExerciseLogs.some((l) => l.logged_at === dateStr);
}

function viewCalendario() {
  const month = state.calendarMonth;
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const firstOfMonth = new Date(year, monthIdx, 1);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lunes = 0

  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayISO();

  const grid = cells.map((d) => {
    if (d === null) return `<span class="cal-cell cal-empty"></span>`;
    const dateStr = dateToISO(new Date(year, monthIdx, d));
    const classes = ['cal-cell'];
    if (dateStr === today) classes.push('cal-today');
    if (dateStr === state.selectedCalendarDate) classes.push('cal-selected');
    if (dayHasActivity(dateStr)) classes.push('cal-active');
    return `<button class="${classes.join(' ')}" data-cal-day="${dateStr}">${d}</button>`;
  }).join('');

  const selected = state.selectedCalendarDate;
  const selMeasurement = state.measurements.find((m) => m.measured_at === selected);
  const selLogs = state.allExerciseLogs.filter((l) => l.logged_at === selected);
  const selLogsByExercise = {};
  selLogs.forEach((l) => {
    if (!selLogsByExercise[l.exercise_id]) selLogsByExercise[l.exercise_id] = [];
    selLogsByExercise[l.exercise_id].push(l);
  });

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Calendario</h2>
        <div>
          <button class="btn-ghost btn-sm" id="cal-prev-month">← Mes anterior</button>
          <button class="btn-ghost btn-sm" id="cal-next-month">Mes siguiente →</button>
        </div>
      </div>
      <h3>${MONTH_LABELS[monthIdx]} ${year}</h3>
      <div class="cal-weekdays">${WEEKDAY_LABELS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${grid}</div>
      <p class="muted">El punto marca los días con alguna medición o serie registrada. Toca un día para ver el detalle.</p>
    </section>
    <section class="panel">
      <h3>${new Date(selected + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      ${!selMeasurement && selLogs.length === 0 ? '<p class="chart-empty">Sin actividad registrada este día.</p>' : ''}
      ${selMeasurement ? `
        <h4>Medición</h4>
        <p>Peso: <strong>${fmt1(selMeasurement.weight_kg)} kg</strong>
          ${selMeasurement.waist_cm ? ` · Cintura: <strong>${fmt1(selMeasurement.waist_cm)} cm</strong>` : ''}
          ${selMeasurement.upper_abdomen_cm ? ` · Tripa: <strong>${fmt1(selMeasurement.upper_abdomen_cm)} cm</strong>` : ''}
          ${selMeasurement.chest_cm ? ` · Pecho: <strong>${fmt1(selMeasurement.chest_cm)} cm</strong>` : ''}
          ${selMeasurement.arm_cm ? ` · Brazo: <strong>${fmt1(selMeasurement.arm_cm)} cm</strong>` : ''}
          ${selMeasurement.leg_cm ? ` · Pierna: <strong>${fmt1(selMeasurement.leg_cm)} cm</strong>` : ''}
        </p>
      ` : ''}
      ${Object.keys(selLogsByExercise).length > 0 ? `
        <h4>Entrenamiento</h4>
        <table class="routine-table">
          <thead><tr><th>Ejercicio</th><th>Series registradas</th></tr></thead>
          <tbody>
            ${Object.entries(selLogsByExercise).map(([exerciseId, logs]) => {
              const ex = state.exercises.find((e) => e.id === exerciseId);
              const summary = logs.map((l) => `${fmt1(l.weight_kg)} kg x ${l.reps ?? '?'} (${l.sets} series)`).join(' · ');
              return `<tr><td>${ex ? ex.name : 'Ejercicio'}</td><td>${summary}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      ` : ''}
    </section>
  `;
}

function viewPerfil() {
  const p = state.profile;
  return `
    <section class="panel">
      <h2>Tu perfil</h2>
      <form id="profile-form">
        <label>Nombre <input type="text" name="full_name" value="${p.full_name || ''}" required /></label>
        <fieldset>
          <legend>Sexo</legend>
          <label class="radio"><input type="radio" name="sex" value="mujer" ${p.sex === 'mujer' ? 'checked' : ''} /> Mujer</label>
          <label class="radio"><input type="radio" name="sex" value="hombre" ${p.sex === 'hombre' ? 'checked' : ''} /> Hombre</label>
        </fieldset>
        <label>Fecha de nacimiento <input type="date" name="birth_date" value="${p.birth_date || ''}" required /></label>
        <label>Altura (cm) <input type="number" name="height_cm" value="${p.height_cm || ''}" step="0.1" min="100" max="250" required /></label>
        <label>Nivel de actividad
          <select name="activity_level">
            ${Object.entries(ACTIVITY_LABELS).map(([v, l]) => `<option value="${v}" ${v === p.activity_level ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <fieldset>
          <legend>Objetivo</legend>
          ${Object.entries(GOAL_LABELS).map(([v, l]) => `
            <label class="radio"><input type="radio" name="goal" value="${v}" ${v === p.goal ? 'checked' : ''} /> ${l}</label>
          `).join('')}
        </fieldset>
        <label>Días de entrenamiento por semana
          <select name="days_per_week">
            ${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === p.days_per_week ? 'selected' : ''}>${n} días</option>`).join('')}
          </select>
        </label>
        ${injuriesFieldsetHTML(p.injuries)}
        <p class="field-error" id="profile-error" hidden></p>
        <p class="field-ok" id="profile-ok" hidden>Guardado.</p>
        <button type="submit" class="btn-primary">Guardar cambios</button>
      </form>
    </section>
    <section class="panel">
      <h2>Cuenta</h2>
      <p class="muted">Sesión iniciada${p.full_name ? ` como ${p.full_name}` : ''}.</p>
      <button class="btn-secondary" id="logout-btn">Cerrar sesión</button>
    </section>
    <section class="panel danger-zone">
      <h2>Zona de riesgo</h2>
      <p class="muted">Borra todas tus mediciones y tu perfil de esta app. Tu cuenta de acceso seguirá existiendo, pero podrás volver a rellenar el cuestionario inicial.</p>
      <button class="btn-danger" id="delete-data-btn">Borrar todos mis datos</button>
    </section>
  `;
}

function wireTabEvents() {
  const measureForm = $('#measure-form');
  if (measureForm) {
    measureForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errorEl = $('#measure-error');
      errorEl.hidden = true;
      const payload = { user_id: state.session.user.id, measured_at: fd.get('measured_at') };
      ['weight_kg', 'waist_cm', 'upper_abdomen_cm', 'chest_cm', 'arm_cm', 'leg_cm'].forEach((k) => {
        const v = fd.get(k);
        payload[k] = v ? Number(v) : null;
      });
      payload.notes = fd.get('notes') ? fd.get('notes').toString().trim() : null;
      try {
        const { error } = await supabase.from('gym_measurements').upsert(payload, { onConflict: 'user_id,measured_at' });
        if (error) throw error;
        await loadUserData();
        render();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
      }
    });
  }

  $$('[data-delete-measure]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta medición?')) return;
    const id = btn.dataset.deleteMeasure;
    await supabase.from('gym_measurements').delete().eq('id', id);
    await loadUserData();
    render();
  }));

  const regenBtn = $('#regen-routine');
  if (regenBtn) regenBtn.addEventListener('click', () => {
    state.routineSeed += 1;
    state.routineOverrides = {};
    state.selectedRoutineDay = null;
    render();
  });

  // Recuerda si el usuario tenía desplegados los estiramientos para que no
  // se cierren solos cada vez que la pestaña Rutina se vuelve a renderizar
  // (p. ej. al marcar uno como hecho).
  const stretchSection = $('#stretch-section');
  if (stretchSection) stretchSection.addEventListener('toggle', () => {
    state.stretchSectionOpen = stretchSection.open;
  });

  const toggleWeekdayPlanBtn = $('#toggle-weekday-plan');
  if (toggleWeekdayPlanBtn) toggleWeekdayPlanBtn.addEventListener('click', () => {
    state.editingWeekdayPlan = !state.editingWeekdayPlan;
    render();
  });

  const weekdayPlanForm = $('#weekday-plan-form');
  if (weekdayPlanForm) weekdayPlanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const raw = WEEKDAY_NAMES.map((_, wd) => fd.get(`wd-${wd}`));
    const baseDaysCount = (SPLITS[state.profile.days_per_week] || SPLITS[3]).length;
    const maxExplicit = raw.reduce((max, v) => (v !== '' && v !== 'new' && Number(v) > max ? Number(v) : max), baseDaysCount - 1);
    let nextNewIndex = maxExplicit + 1;
    if (raw.includes('new') && nextNewIndex + raw.filter((v) => v === 'new').length - 1 > MAX_ROUTINE_DAY_INDEX) {
      alert('No caben más días nuevos: como mucho un entrenamiento distinto por cada día de la semana.');
      return;
    }
    const plan = raw.map((v) => {
      if (v === '') return null;
      if (v === 'new') { const idx = nextNewIndex; nextNewIndex += 1; return idx; }
      return Number(v);
    });
    await supabase.from('gym_profiles').update({ weekday_plan: plan }).eq('id', state.session.user.id);
    state.profile.weekday_plan = plan;
    state.editingWeekdayPlan = false;
    state.selectedRoutineDay = null;
    render();
  });

  const resetWeekdayPlanBtn = $('#reset-weekday-plan');
  if (resetWeekdayPlanBtn) resetWeekdayPlanBtn.addEventListener('click', async () => {
    await supabase.from('gym_profiles').update({ weekday_plan: null }).eq('id', state.session.user.id);
    state.profile.weekday_plan = null;
    state.editingWeekdayPlan = false;
    state.selectedRoutineDay = null;
    render();
  });

  $$('[data-swap-slot]').forEach((btn) => btn.addEventListener('click', () => {
    const dayIndex = Number(btn.dataset.swapDay);
    const slotIndex = Number(btn.dataset.swapSlot);
    const current = state.exercises.find((e) => e.id === btn.dataset.swapExercise);
    if (!current) return;
    const baseDaysCount = (SPLITS[state.profile.days_per_week] || SPLITS[3]).length;
    const extraDaysCount = extraDaysCountFor(weekdayPlanFor(state.profile), baseDaysCount);
    const routine = applyRoutineOverrides(generateRoutine(state.profile, state.exercises, currentRoutineSeed(), extraDaysCount));
    const usedIdsThatDay = new Set(routine[dayIndex].exercises.map((e) => e.id));
    const groupExercises = state.exercises
      .filter((e) => e.muscle_group === current.muscle_group)
      .sort((a, b) => a.sort_order - b.sort_order);
    const currentIdx = groupExercises.findIndex((e) => e.id === current.id);
    let next = null;
    for (let step = 1; step <= groupExercises.length; step++) {
      const candidate = groupExercises[(currentIdx + step) % groupExercises.length];
      if (!usedIdsThatDay.has(candidate.id)) { next = candidate; break; }
    }
    if (!next) {
      alert('No hay más ejercicios de este grupo muscular en el catálogo para sustituirlo.');
      return;
    }
    state.routineOverrides[`${dayIndex}-${slotIndex}`] = next.id;
    render();
  }));

  $$('[data-routine-day]').forEach((btn) => btn.addEventListener('click', () => {
    state.selectedRoutineDay = Number(btn.dataset.routineDay);
    render();
  }));

  $$('[data-mark-done]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const ok = await markExerciseDoneToday(btn.dataset.markDone);
    if (!ok) btn.disabled = false;
  }));

  const addExtraBtn = $('#add-extra-exercise');
  if (addExtraBtn) addExtraBtn.addEventListener('click', async () => {
    const select = $('#extra-exercise-select');
    if (!select || !select.value) return;
    addExtraBtn.disabled = true;
    const ok = await markExerciseDoneToday(select.value);
    if (!ok) addExtraBtn.disabled = false;
  });

  $$('[data-remove-extra-log]').forEach((btn) => btn.addEventListener('click', async () => {
    const logId = btn.dataset.removeExtraLog;
    btn.disabled = true;
    const { error } = await supabase.from('gym_exercise_logs').delete().eq('id', logId);
    if (error) {
      btn.disabled = false;
      alert('No se pudo quitar: ' + error.message);
      return;
    }
    state.allExerciseLogs = state.allExerciseLogs.filter((l) => l.id !== logId);
    render();
  }));

  $$('[data-open-exercise]').forEach((btn) => btn.addEventListener('click', () => {
    openExercise(btn.dataset.openExercise);
  }));

  $$('[data-cal-day]').forEach((btn) => btn.addEventListener('click', () => {
    state.selectedCalendarDate = btn.dataset.calDay;
    render();
  }));
  const calPrev = $('#cal-prev-month');
  if (calPrev) calPrev.addEventListener('click', () => {
    const m = new Date(state.calendarMonth);
    m.setMonth(m.getMonth() - 1);
    state.calendarMonth = m;
    render();
  });
  const calNext = $('#cal-next-month');
  if (calNext) calNext.addEventListener('click', () => {
    const m = new Date(state.calendarMonth);
    m.setMonth(m.getMonth() + 1);
    state.calendarMonth = m;
    render();
  });

  const backBtn = $('[data-back-to-rutina]');
  if (backBtn) backBtn.addEventListener('click', () => {
    // Coincide con lo que hace el botón "atrás" del móvil: reutiliza la
    // misma entrada del historial en vez de apilar una nueva.
    if (history.state && history.state.tab === 'ejercicio') {
      history.back();
    } else {
      goToTab('rutina');
    }
  });

  const logForm = $('#log-form');
  if (logForm) {
    logForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errorEl = $('#log-error');
      errorEl.hidden = true;
      const currentExercise = state.exercises.find((e2) => e2.id === state.selectedExerciseId);
      const isCardio = currentExercise && currentExercise.muscle_group === 'cardio';
      const payload = isCardio
        ? {
            user_id: state.session.user.id,
            exercise_id: state.selectedExerciseId,
            logged_at: fd.get('logged_at'),
            speed_kmh: fd.get('speed_kmh') ? Number(fd.get('speed_kmh')) : null,
            duration_min: fd.get('duration_min') ? Number(fd.get('duration_min')) : null,
            sets: 1,
          }
        : {
            user_id: state.session.user.id,
            exercise_id: state.selectedExerciseId,
            logged_at: fd.get('logged_at'),
            weight_kg: fd.get('weight_kg') ? Number(fd.get('weight_kg')) : null,
            reps: fd.get('reps') ? Number(fd.get('reps')) : null,
            sets: fd.get('sets') ? Number(fd.get('sets')) : 1,
          };
      try {
        const { error } = await supabase.from('gym_exercise_logs').insert(payload);
        if (error) throw error;
        await reloadExerciseLogs();
        render();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
      }
    });
  }

  $$('[data-delete-log]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('¿Borrar este registro?')) return;
    await supabase.from('gym_exercise_logs').delete().eq('id', btn.dataset.deleteLog);
    await reloadExerciseLogs();
    render();
  }));

  const noteEl = $('#exercise-note');
  if (noteEl) {
    noteEl.addEventListener('blur', async () => {
      const note = noteEl.value;
      if (note === state.exerciseNote) return;
      state.exerciseNote = note;
      await supabase.from('gym_exercise_notes').upsert(
        { user_id: state.session.user.id, exercise_id: state.selectedExerciseId, note, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,exercise_id' }
      );
      const okEl = $('#note-ok');
      if (okEl) {
        okEl.hidden = false;
        setTimeout(() => { okEl.hidden = true; }, 2000);
      }
    });
  }

  const profileForm = $('#profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errorEl = $('#profile-error');
      const okEl = $('#profile-ok');
      errorEl.hidden = true;
      okEl.hidden = true;
      const payload = {
        id: state.session.user.id,
        full_name: fd.get('full_name').toString().trim(),
        sex: fd.get('sex'),
        birth_date: fd.get('birth_date'),
        height_cm: Number(fd.get('height_cm')),
        activity_level: fd.get('activity_level'),
        goal: fd.get('goal'),
        days_per_week: Number(fd.get('days_per_week')),
        injuries: fd.getAll('injuries'),
      };
      try {
        const { error } = await supabase.from('gym_profiles').upsert(payload);
        if (error) throw error;
        await loadUserData();
        state.routineOverrides = {};
        state.selectedRoutineDay = null;
        okEl.hidden = false;
        render();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
      }
    });
  }

  const logoutBtn = $('#logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  const deleteBtn = $('#delete-data-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('Esto borrará tu perfil y todas tus mediciones de Rincón Fit. ¿Seguro?')) return;
    const userId = state.session.user.id;
    await supabase.from('gym_measurements').delete().eq('user_id', userId);
    await supabase.from('gym_profiles').delete().eq('id', userId);
    state.profile = null;
    state.measurements = [];
    render();
  });
}

// ---------------------------------------------------------------------------
// Carga de datos y arranque
// ---------------------------------------------------------------------------
async function loadUserData() {
  const userId = state.session.user.id;
  const [{ data: profile }, { data: measurements }, { data: exercises }, { data: allLogs }] = await Promise.all([
    supabase.from('gym_profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('gym_measurements').select('*').eq('user_id', userId).order('measured_at', { ascending: true }),
    state.exercises.length ? Promise.resolve({ data: state.exercises }) : supabase.from('gym_exercises').select('*').order('sort_order'),
    supabase.from('gym_exercise_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: true }),
  ]);
  state.profile = profile || null;
  state.measurements = measurements || [];
  state.exercises = exercises || [];
  state.allExerciseLogs = allLogs || [];
}

async function reloadExerciseLogs() {
  const userId = state.session.user.id;
  const { data } = await supabase
    .from('gym_exercise_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('exercise_id', state.selectedExerciseId)
    .order('logged_at', { ascending: true });
  state.exerciseLogs = data || [];
  state.allExerciseLogs = [
    ...state.allExerciseLogs.filter((l) => l.exercise_id !== state.selectedExerciseId),
    ...state.exerciseLogs,
  ];
}

async function loadExerciseDetail(exerciseId) {
  state.selectedExerciseId = exerciseId;
  state.tab = 'ejercicio';
  state.exerciseDetailLoading = true;
  render();

  const userId = state.session.user.id;
  const [{ data: logs }, { data: noteRow }] = await Promise.all([
    supabase.from('gym_exercise_logs').select('*').eq('user_id', userId).eq('exercise_id', exerciseId).order('logged_at', { ascending: true }),
    supabase.from('gym_exercise_notes').select('*').eq('user_id', userId).eq('exercise_id', exerciseId).maybeSingle(),
  ]);
  state.exerciseLogs = logs || [];
  state.exerciseNote = noteRow ? noteRow.note : '';
  state.exerciseDetailLoading = false;
  render();
}

// Navegación con soporte del botón "atrás" del móvil: cada cambio de
// pestaña o de ejercicio abierto se registra en el historial del
// navegador, para que "atrás" vuelva a la pantalla anterior de la app en
// vez de salir de ella directamente.
function pushHistory(tab, exerciseId) {
  const hash = tab === 'ejercicio' ? `#ejercicio-${exerciseId}` : `#${tab}`;
  history.pushState({ tab, exerciseId: exerciseId || null }, '', hash);
}

function goToTab(tab) {
  pushHistory(tab);
  if (tab === 'admin') { loadAdminStats(); return; }
  state.tab = tab;
  render();
}

function openExercise(exerciseId) {
  pushHistory('ejercicio', exerciseId);
  loadExerciseDetail(exerciseId);
}

function handlePopState(e) {
  const s = e.state;
  if (!s || !s.tab) {
    state.tab = 'resumen';
    render();
    return;
  }
  if (s.tab === 'ejercicio' && s.exerciseId) {
    loadExerciseDetail(s.exerciseId);
  } else {
    state.tab = s.tab;
    render();
  }
}

// El enlace de recuperación de contraseña del email redirige aquí con
// #access_token=...&type=recovery (o ?type=recovery con el flujo PKCE) en la
// URL. Supabase ya lo procesa solo y arma una sesión con ese enlace, pero el
// evento "PASSWORD_RECOVERY" que lo señala puede dispararse antes de que nos
// suscribamos a onAuthStateChange (justo al crear el cliente), así que
// comprobamos también la URL a mano para no perdernos ese caso y acabar
// metiendo a la persona directamente en la app sin dejarle cambiar la
// contraseña.
function isPasswordRecoveryLink() {
  return location.hash.includes('type=recovery') || new URLSearchParams(location.search).get('type') === 'recovery';
}

async function init() {
  const recoveryLink = isPasswordRecoveryLink();
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  if (recoveryLink && session) {
    state.passwordRecovery = true;
  } else if (session) {
    await loadUserData();
  }
  history.replaceState({ tab: state.tab }, '', `#${state.tab}`);
  render();

  window.addEventListener('popstate', handlePopState);

  supabase.auth.onAuthStateChange(async (event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') {
      state.passwordRecovery = true;
      render();
      return;
    }
    if (session) {
      await loadUserData();
    } else {
      state.profile = null;
      state.measurements = [];
      state.tab = 'resumen';
      state.authMode = null;
      state.passwordRecovery = false;
      history.replaceState(null, '', location.pathname);
    }
    render();
  });
}

init();
