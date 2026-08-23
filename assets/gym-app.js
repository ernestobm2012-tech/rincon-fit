import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://ztsdkfwnqrlmsirfvoat.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0c2RrZnducXJsbXNpcmZ2b2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwOTM5OTksImV4cCI6MjA5ODY2OTk5OX0.ODimfaCqTpK8fkY4Oobk8kSR3rppb_afmoTTXG8H2os';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmt1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(1));
const fmt0 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Math.round(n));
const todayISO = () => new Date().toISOString().slice(0, 10);

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
// Generador de rutina: reparte ejercicios del catálogo en un split semanal
// según los días/semana y el objetivo del perfil.
// ---------------------------------------------------------------------------
const SPLITS = {
  2: [['pecho', 'espalda', 'piernas', 'core'], ['hombros', 'brazos', 'piernas', 'gluteos', 'cardio']],
  3: [['pecho', 'hombros', 'brazos'], ['espalda', 'core'], ['piernas', 'gluteos', 'cardio']],
  4: [['pecho', 'brazos'], ['espalda', 'core'], ['piernas', 'gluteos'], ['hombros', 'cardio']],
  5: [['pecho'], ['espalda'], ['piernas', 'gluteos'], ['hombros'], ['brazos', 'core', 'cardio']],
  6: [['pecho', 'brazos'], ['espalda', 'core'], ['piernas'], ['hombros', 'brazos'], ['piernas', 'gluteos'], ['cardio', 'core']],
};

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

function generateRoutine(profile, exercises, seed) {
  const days = SPLITS[profile.days_per_week] || SPLITS[3];
  const perGroupCount = 2;
  return days.map((groups, i) => {
    const dayExercises = [];
    groups.forEach((group) => {
      const pool = exercises.filter(
        (e) => e.muscle_group === group && e.goals.includes(profile.goal)
      );
      const picked = seededShuffle(pool, seed + i + group.length).slice(0, perGroupCount);
      dayExercises.push(...picked);
    });
    return { label: `Día ${i + 1} — ${groups.map((g) => MUSCLE_LABELS[g]).join(' + ')}`, exercises: dayExercises };
  });
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
  if (!state.session) return renderAuth();
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
        <p class="field-error" id="auth-error" hidden></p>
        <button type="submit" class="btn-primary" id="auth-submit">Entrar</button>
      </form>
    </section>
  `;
  let mode = 'login';
  $$('.tab-mini').forEach((btn) => btn.addEventListener('click', () => {
    mode = btn.dataset.authtab;
    $$('.tab-mini').forEach((b) => b.classList.toggle('active', b === btn));
    $('#auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
    $('#auth-form input[name=password]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  }));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').toString().trim();
    const password = fd.get('password').toString();
    const errorEl = $('#auth-error');
    errorEl.hidden = true;
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

function renderApp() {
  const p = state.profile;
  root.innerHTML = `
    <header class="app-header">
      <div class="brand">Rincón Fit</div>
      <nav class="tabs">
        ${['resumen', 'rutina', 'dieta', 'medidas', 'perfil'].map((t) => `
          <button class="tab ${state.tab === t ? 'active' : ''}" data-tab="${t}">${tabLabel(t)}</button>
        `).join('')}
      </nav>
      <button class="btn-ghost" id="logout-btn">Salir</button>
    </header>
    <main class="app-main" id="app-main"></main>
  `;
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => {
    state.tab = btn.dataset.tab;
    render();
  }));
  $('#logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  const main = $('#app-main');
  if (state.tab === 'resumen') main.innerHTML = viewResumen();
  else if (state.tab === 'rutina') main.innerHTML = viewRutina();
  else if (state.tab === 'dieta') main.innerHTML = viewDieta();
  else if (state.tab === 'medidas') main.innerHTML = viewMedidas();
  else if (state.tab === 'perfil') main.innerHTML = viewPerfil();

  wireTabEvents();
}

function tabLabel(t) {
  return { resumen: 'Resumen', rutina: 'Rutina', dieta: 'Dieta', medidas: 'Medidas', perfil: 'Perfil' }[t];
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

function viewRutina() {
  const p = state.profile;
  const routine = generateRoutine(p, state.exercises, state.routineSeed);
  const vol = GOAL_VOLUME[p.goal];
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Rutina — ${GOAL_LABELS[p.goal]}</h2>
        <button class="btn-secondary" id="regen-routine">Generar otra variante</button>
      </div>
      <p>Pauta general: <strong>${vol.sets} series</strong> de <strong>${vol.reps} repeticiones</strong>, descanso de <strong>${vol.rest}</strong> entre series. Ajusta el peso para que las últimas 2 repeticiones cuesten de verdad sin perder la técnica.</p>
      ${routine.map((day) => `
        <div class="routine-day">
          <h3>${day.label}</h3>
          ${day.exercises.length === 0 ? '<p class="chart-empty">No hay ejercicios suficientes en el catálogo para este grupo.</p>' : `
          <table class="routine-table">
            <thead><tr><th>Ejercicio</th><th>Máquina / equipo</th><th>Series x reps</th></tr></thead>
            <tbody>
              ${day.exercises.map((ex) => `
                <tr>
                  <td>
                    <strong>${ex.name}</strong>
                    <p class="muted">${ex.instructions}</p>
                  </td>
                  <td>${ex.machine}</td>
                  <td>${vol.sets} x ${vol.reps}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      `).join('')}
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
  const distribution = [
    { label: 'Desayuno', pct: 0.25 },
    { label: 'Comida', pct: 0.35 },
    { label: 'Merienda', pct: 0.15 },
    { label: 'Cena', pct: 0.25 },
  ];
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
      <h3>Reparto sugerido a lo largo del día</h3>
      <table class="routine-table">
        <thead><tr><th>Comida</th><th>% calorías</th><th>Aprox. kcal</th></tr></thead>
        <tbody>
          ${distribution.map((d) => `<tr><td>${d.label}</td><td>${Math.round(d.pct * 100)}%</td><td>${fmt0(targets.calories * d.pct)} kcal</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="muted">Ideas de alimentos: proteína (pollo, pavo, pescado, huevos, legumbres, lácteos altos en proteína), carbohidratos (arroz, patata, avena, fruta, pan integral) y grasas (aceite de oliva, frutos secos, aguacate). Este cálculo es orientativo y no sustituye a un/a nutricionista si tienes alguna condición médica.</p>
    </section>
  `;
}

function viewMedidas() {
  const p = state.profile;
  const rows = state.measurements.slice().reverse();
  const wPoints = state.measurements.filter((x) => x.waist_cm != null).map((x) => ({ x: new Date(x.measured_at), y: Number(x.waist_cm) }));
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
      <h3>IMC</h3>
      ${lineChart(bmiPoints, { color: '#7bb661', unit: '' })}
    </section>
    <section class="panel">
      <h2>Histórico</h2>
      ${rows.length === 0 ? '<p class="chart-empty">Todavía no hay mediciones.</p>' : `
      <div class="table-scroll">
      <table class="routine-table">
        <thead><tr><th>Fecha</th><th>Peso</th><th>Cintura</th><th>Pecho</th><th>Brazo</th><th>Pierna</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${new Date(r.measured_at).toLocaleDateString('es-ES')}</td>
              <td>${fmt1(r.weight_kg)}</td>
              <td>${fmt1(r.waist_cm)}</td>
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
        <p class="field-error" id="profile-error" hidden></p>
        <p class="field-ok" id="profile-ok" hidden>Guardado.</p>
        <button type="submit" class="btn-primary">Guardar cambios</button>
      </form>
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
      ['weight_kg', 'waist_cm', 'chest_cm', 'arm_cm', 'leg_cm'].forEach((k) => {
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
    render();
  });

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
      };
      try {
        const { error } = await supabase.from('gym_profiles').upsert(payload);
        if (error) throw error;
        await loadUserData();
        okEl.hidden = false;
        render();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
      }
    });
  }

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
  const [{ data: profile }, { data: measurements }, { data: exercises }] = await Promise.all([
    supabase.from('gym_profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('gym_measurements').select('*').eq('user_id', userId).order('measured_at', { ascending: true }),
    state.exercises.length ? Promise.resolve({ data: state.exercises }) : supabase.from('gym_exercises').select('*').order('sort_order'),
  ]);
  state.profile = profile || null;
  state.measurements = measurements || [];
  state.exercises = exercises || [];
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  if (session) await loadUserData();
  render();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    if (session) {
      await loadUserData();
    } else {
      state.profile = null;
      state.measurements = [];
    }
    render();
  });
}

init();
