# Rincón Fit — rutinas, dieta y evolución personalizadas

Sitio de una sola página (`index.html`) para gestionar tu entrenamiento de
gimnasio de forma personal: rutina según tu objetivo, dieta orientativa y
seguimiento de tu evolución (peso, IMC y perímetros) a lo largo del tiempo.

Repositorio independiente, sin relación con ningún otro proyecto ("Mi
Pequeño Rincón", "Lienzo Blanco", etc.) — solo comparte el proyecto
Supabase de fondo, y ahí también está completamente aislado (ver más
abajo).

Sin build step: es HTML/CSS/JS puro + Supabase JS por CDN, así que se puede
abrir tal cual o subir a cualquier hosting estático (GitHub Pages, Netlify,
Vercel...).

## Qué incluye

- **Cuenta propia** (email + contraseña vía Supabase Auth): cada persona
  entra con su cuenta y solo ve sus propios datos. Si se olvida la
  contraseña, puede pedir un enlace de recuperación por email desde la
  pantalla de entrada y elegir una nueva.
- **Cuestionario inicial**: sexo, fecha de nacimiento, altura, peso, nivel
  de actividad, objetivo (pérdida de peso / definición / aumento de masa) y
  días de entrenamiento por semana.
- **Rutina generada** a partir de un catálogo de 58 ejercicios (máquinas,
  barra, peso corporal y bastantes con mancuernas) con su máquina/equipo,
  grupo muscular e instrucciones, repartida en un split semanal según los
  días disponibles, con series/repeticiones/descanso ajustados al objetivo.
  Se renueva sola cada semana natural evitando repetir los ejercicios de la
  semana anterior en la medida que el catálogo lo permite, y también se
  puede regenerar a mano para tener variedad al momento.
- **Días de entreno editables**: qué día de la semana corresponde a cada
  entrenamiento se puede personalizar desde "Editar mis días" en Rutina —
  repetir uno ya existente, añadir un "Día nuevo" con ejercicios propios,
  mover uno de sitio (p. ej. cambiar el jueves por el miércoles) o entrenar
  más o menos días de los habituales una semana concreta, sin tocar los
  días/semana de Perfil.
- **Estiramientos opcionales** (10 más, antes y/o después de entrenar) en
  una sección aparte y plegada por defecto: no cuentan para la rutina ni
  son obligatorios, solo una ayuda para calentar y soltar músculo.
- **Dieta orientativa**: calorías y macros calculados con la fórmula de
  Mifflin-St Jeor (específica por sexo), ajustados al objetivo (déficit,
  déficit ligero o superávit), con alimentos concretos y gramos por comida.
  Cada día de la semana trae una combinación de alimentos distinta (sin
  perder de vista las mismas calorías/macros objetivo), se puede consultar
  la semana completa de un vistazo, adelantar a la semana que viene para
  hacer la compra con antelación, y exportar a PDF desde el propio
  navegador el día, la semana completa o solo la lista de la compra (suma
  de todos los alimentos de los 7 días) por separado.
- **Evolución guardada**: cada medición (peso, cintura, tripa por encima
  del ombligo, pecho, brazo, pierna) queda registrada con fecha, con
  gráficos de evolución de peso, cintura, tripa e IMC, y categorías (IMC,
  riesgo por perímetro de cintura) que usan los umbrales específicos por
  sexo.
- **Progreso por ejercicio** adaptado al tipo: peso/reps/series y 1RM
  estimado para ejercicios de fuerza, velocidad y tiempo para los de
  cardio (cinta, bici, elíptica...).
- Todo el contenido es privado por usuario mediante Row Level Security: solo
  tú puedes ver y editar tus propios datos.
- **Panel de administración** (pestaña "Admin", solo visible para el
  propietario de la app): cuántos usuarios se han registrado en total, en
  los últimos 7 y 30 días, y el listado de las últimas altas. Se apoya en
  la función `gym_admin_stats` de Supabase, que comprueba en el servidor
  que quien llama es el propietario (por su id de usuario) antes de
  devolver nada — cualquier otra persona autenticada recibe un error, y la
  pestaña ni siquiera se muestra en su menú.

## Base de datos

Usa el proyecto Supabase `mi-pequeno-rincon` (`ztsdkfwnqrlmsirfvoat`), que
también aloja las tablas de otros dos negocios sin relación con esto (la
sala de eventos y "Lienzo Blanco"). Las tablas de este repositorio son
propias y están completamente aisladas: llevan el prefijo `gym_` y sus
políticas de Row Level Security restringen cada fila al usuario propietario
(`auth.uid()`), así que no hay forma de que un usuario vea datos de otro
usuario ni de las tablas de los otros dos proyectos, y viceversa.

### Tablas (prefijo `gym_`)

- `gym_profiles` — un perfil por usuario: sexo, altura, fecha de
  nacimiento, nivel de actividad, objetivo, días de entrenamiento y, si el
  usuario lo ha personalizado, qué día de rutina toca cada día de la semana
  (`weekday_plan`).
- `gym_measurements` — histórico de mediciones (peso y perímetros) por
  usuario y fecha, una fila por día.
- `gym_exercises` — catálogo de ejercicios/máquinas (lectura pública,
  gestionado solo desde el dashboard/SQL, no editable desde el navegador).
- `gym_exercise_logs` / `gym_exercise_notes` — progreso (peso/reps/series
  para fuerza, velocidad/duración para cardio) y nota personal por usuario
  y ejercicio.

Para añadir o editar ejercicios del catálogo: dashboard de Supabase → SQL
Editor, `insert`/`update` sobre `gym_exercises`.

## Fotos de los ejercicios

Las dos fotos por ejercicio en `assets/exercise-photos/` vienen de
[Free Exercise DB](https://github.com/yuhonas/free-exercise-db), un banco de
imágenes de gimnasio de dominio público (licencia
[Unlicense](https://unlicense.org/), sin restricciones ni atribución
obligatoria). El campo `photo_ref` de `gym_exercises` guarda el nombre de la
carpeta correspondiente en ese dataset.

Habilita **Authentication → Providers → Email** en el dashboard de Supabase
si no está ya activo, para que el registro con email/contraseña funcione.
Si el proyecto tiene activada la confirmación por email, el usuario deberá
confirmar su correo antes de poder iniciar sesión.

## Cómo lo pruebas en local

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Publicarlo

Sin build step, así que vale cualquier hosting estático: GitHub Pages,
Netlify, Vercel... arrastrando la carpeta o conectando este repositorio.
