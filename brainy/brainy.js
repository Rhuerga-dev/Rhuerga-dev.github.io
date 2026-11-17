// Brainy · vista pública (huergalabs.dev/brainy)
// Un cerebro 3D que se enciende según lo que Brainy ha aprendido. Sin librerías: los puntos se guardan en
// 3D (x, y, z) y en cada cuadro se giran y se proyectan sobre un canvas 2D. Los datos salen de brainy.json,
// que el panel de Huerga Labs publica solo con una lista blanca (progreso, hitos del plan y fechas).
// El dibujo (secciones 1–4) es el mismo que usa el panel, copiado aquí para no depender de él.
(() => {
    'use strict';

    const root = document.getElementById('brain');
    const canvas = document.getElementById('brain-canvas');
    if (!root || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const PHASES = 5;
    const COLORS = ['#7c9cff', '#4ac487', '#e6a64a', '#f07a9a', '#b58cff'];   // un color por fase (= región)
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');        // «Reducir movimiento»
    let lang = 'en';
    let data = { progress: 0, phases: [], history: [], metrics: { mnist_precision: [] } };
    let loaded = false;                                                        // ¿llegó brainy.json?

    // ---------- 1. Construir el cerebro (una sola vez) ----------

    // Azar con semilla: el cerebro sale igual cada vez que se abre la página.
    function seeded(seed) {
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const rand = seeded(20261117);

    // Surcos: ondas mezcladas; donde se cruzan por cero hay un pliegue (menos neuronas y algo hundidas).
    function groove(x, y, z) {
        const n = Math.sin(11 * x + 3 * Math.sin(4 * z)) + Math.sin(9 * z + 2.5 * Math.sin(5 * y)) + Math.sin(10 * y + 2 * Math.sin(6 * x));
        return Math.exp(-((n / 0.35) ** 2));
    }

    // Dirección al azar repartida por igual en una esfera.
    function direction() {
        const u = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        return [s * Math.cos(a), u, s * Math.sin(a)];
    }

    // Ejes: x = izquierda/derecha, y = arriba, z = delante (+) / atrás (−). Fase 0..4 = región.
    const total = window.innerWidth < 720 ? 2800 : 3800;
    const px = [], py = [], pz = [], phase = [];
    const add = (x, y, z, ph) => { px.push(x); py.push(y); pz.push(z); phase.push(ph); };

    // Corteza (dos hemisferios) y núcleo.
    while (px.length < total * 0.74) {
        const [dx, dy, dz] = direction();
        const deep = rand() < 0.2;
        let r = deep ? 0.25 + 0.6 * rand() : 0.93 + 0.07 * rand();
        let x = dx * 0.74 * r, y = dy * 0.62 * r, z = dz * r;
        if (!deep) {
            const g = groove(x, y, z);
            if (g > 0.55 && rand() < 0.75) continue;      // el surco se ve porque ahí hay menos puntos
            const k = 1 - 0.07 * g;
            x *= k; y *= k; z *= k;
        }
        if (y < 0) y *= 0.72;                             // base más plana
        x *= 1 - 0.13 * z;                                // más estrecho delante, más ancho atrás
        const ax = Math.abs(x);
        if (y > -0.1) y -= 0.16 * Math.exp(-((ax / 0.1) ** 2));   // la cisura hunde el centro por arriba
        x = (x < 0 ? -1 : 1) * (ax * 0.93 + 0.045);       // y separa los dos hemisferios
        let ph;
        if (deep && r < 0.6) ph = 4;                      // núcleo: conexiones
        else if (z < -0.42) ph = 0;                       // occipital (atrás)
        else if (y < -0.1 && ax > 0.28 && z < 0.5) ph = 2;   // temporal (abajo, a los lados)
        else if (z > 0.18) ph = 3;                        // frontal (delante)
        else ph = 1;                                      // parietal (arriba)
        add(x, y, z, ph);
    }
    // Lóbulos temporales: un bulto a cada lado.
    while (px.length < total * 0.83) {
        const [dx, dy, dz] = direction();
        const r = 0.85 + 0.15 * rand(), side = rand() < 0.5 ? -1 : 1;
        add(side * 0.5 + dx * 0.17 * r, -0.3 + dy * 0.15 * r, 0.12 + dz * 0.42 * r, 2);
    }
    // Cerebelo: abajo y atrás, con láminas horizontales.
    while (px.length < total * 0.96) {
        const [dx, dy, dz] = direction();
        const r = rand() < 0.25 ? 0.4 + 0.5 * rand() : 0.94 + 0.06 * rand();
        const y = Math.round(dy * 0.2 * r * 26) / 26;
        add(dx * 0.46 * r, -0.5 + y, -0.6 + dz * 0.27 * r, 4);
    }
    // Tronco: un tubo que baja.
    while (px.length < total) {
        const t = rand(), a = rand() * Math.PI * 2, r = (0.1 - 0.035 * t) * Math.sqrt(rand());
        add(Math.cos(a) * r, -0.42 - 0.56 * t, -0.28 - 0.12 * t + Math.sin(a) * r, 4);
    }

    const N = px.length;
    const X = Float32Array.from(px), Y = Float32Array.from(py), Z = Float32Array.from(pz), PH = Uint8Array.from(phase);

    // Umbral de cada neurona (0..1): se enciende cuando el progreso de su fase lo supera. Crece con la
    // distancia al centro de la región, así el aprendizaje se ve extenderse desde dentro hacia fuera.
    const THR = new Float32Array(N);
    for (let p = 0; p < PHASES; p++) {
        const ids = [];
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < N; i++) if (PH[i] === p) { ids.push(i); cx += Math.abs(X[i]); cy += Y[i]; cz += Z[i]; }
        if (!ids.length) continue;
        cx /= ids.length; cy /= ids.length; cz /= ids.length;
        const dist = new Map(ids.map((i) => [i, Math.hypot(Math.abs(X[i]) - cx, Y[i] - cy, Z[i] - cz) * (0.88 + 0.24 * rand())]));
        ids.sort((a, b) => dist.get(a) - dist.get(b));
        ids.forEach((i, rank) => { THR[i] = (rank + 0.5) / ids.length; });
    }

    // Conexiones: cada neurona con sus 2 vecinas más cercanas (se buscan con una rejilla, no una por una).
    const edges = [];
    let tractsFrom = 0;                          // desde esta conexión en adelante son tractos largos
    {
        const CELL = 0.14, grid = new Map(), seen = new Set();
        const key = (a, b, c) => a + ',' + b + ',' + c;
        const cell = (v) => Math.floor(v / CELL);
        for (let i = 0; i < N; i++) {
            const k = key(cell(X[i]), cell(Y[i]), cell(Z[i]));
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(i);
        }
        for (let i = 0; i < N; i++) {
            const gx = cell(X[i]), gy = cell(Y[i]), gz = cell(Z[i]);
            let b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
                const list = grid.get(key(gx + a, gy + b, gz + c));
                if (!list) continue;
                for (const j of list) {
                    if (j === i) continue;
                    const d = (X[i] - X[j]) ** 2 + (Y[i] - Y[j]) ** 2 + (Z[i] - Z[j]) ** 2;
                    if (d < d1) { b2 = b1; d2 = d1; b1 = j; d1 = d; } else if (d < d2) { b2 = j; d2 = d; }
                }
            }
            for (const j of [b1, b2]) {
                if (j < 0) continue;
                const k = i < j ? i * N + j : j * N + i;
                if (!seen.has(k)) { seen.add(k); edges.push(i, j, PH[i]); }
            }
        }
        // Tractos largos: del núcleo a la corteza (fase 5: lo que conecta todas las regiones).
        const core = [], cortex = [];
        tractsFrom = edges.length / 3;
        for (let i = 0; i < N; i++) (PH[i] === 4 ? core : cortex).push(i);
        for (let n = 0; n < 170 && core.length && cortex.length; n++) {
            edges.push(core[Math.floor(rand() * core.length)], cortex[Math.floor(rand() * cortex.length)], 4);
        }
    }
    const E = edges.length / 3;
    const EA = new Uint16Array(E), EB = new Uint16Array(E), EP = new Uint8Array(E), ELIT = new Uint8Array(E);
    for (let e = 0; e < E; e++) { EA[e] = edges[e * 3]; EB[e] = edges[e * 3 + 1]; EP[e] = edges[e * 3 + 2]; }

    // ---------- 2. Estado ----------

    const shown = new Float32Array(PHASES);      // progreso de cada fase que se está dibujando (va hacia target)
    let target = new Array(PHASES).fill(0);      // progreso al que tiene que llegar
    const ON = new Uint8Array(N);                // 1 = neurona encendida
    const GLOW = new Float32Array(N);            // destello al encenderse (1 → 0)
    let lit = [];                                // conexiones encendidas (para los impulsos)
    let active = 0;
    const pulses = [];                           // impulsos: { e: conexión, t: 0..1, v: velocidad }

    const neuronsEl = document.getElementById('brain-neurons');
    const fmt = (n) => n.toLocaleString(lang);

    function updateOn() {
        let changed = false;
        for (let i = 0; i < N; i++) {
            const v = shown[PH[i]] > THR[i] ? 1 : 0;
            if (v !== ON[i]) { ON[i] = v; if (v) GLOW[i] = 1; changed = true; }
        }
        if (!changed) return;
        active = 0;
        for (let i = 0; i < N; i++) active += ON[i];
        lit = [];
        for (let e = 0; e < E; e++) {
            ELIT[e] = ON[EA[e]] && ON[EB[e]] ? 1 : 0;
            if (ELIT[e]) lit.push(e);
        }
        if (neuronsEl) neuronsEl.textContent = fmt(active);
    }

    // ---------- 3. Dibujar ----------

    let yaw = -0.95, pitch = 0.22, zoom = 1;     // giro horizontal, inclinación y acercamiento
    let dragging = false, resumeAt = 0, last = 0, raf = 0;
    let dpr = 1;
    const SX = new Float32Array(N), SY = new Float32Array(N), SK = new Float32Array(N), SB = new Uint8Array(N);
    const TAU = Math.PI * 2;

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        schedule();
    }

    function draw(dt) {
        const w = canvas.width, h = canvas.height;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0a1210';
        ctx.fillRect(0, 0, w, h);

        // Girar cada punto (primero alrededor del eje vertical, luego inclinar) y proyectarlo:
        // lo que está más cerca de la cámara (z grande) se dibuja más grande.
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const R = Math.min(w, h) * 0.46 * zoom, D = 3.4, ox = w / 2, oy = h / 2;
        for (let i = 0; i < N; i++) {
            const x = X[i], y = Y[i] + 0.14, z = Z[i];
            const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
            const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
            const k = D / (D - z2);
            SX[i] = ox + x1 * R * k; SY[i] = oy - y2 * R * k; SK[i] = k;
            SB[i] = z2 < -0.3 ? 0 : z2 < 0.3 ? 1 : 2;     // fondo, medio, frente (para atenuar lo lejano)
        }

        // Conexiones apagadas: muy tenues, todas en un solo trazo.
        ctx.lineWidth = 0.6 * dpr;
        ctx.strokeStyle = 'rgba(130,150,190,0.07)';
        ctx.beginPath();
        for (let e = 0; e < E; e++) {
            if (ELIT[e] || e >= tractsFrom) continue;     // los tractos largos apagados no se pintan
            ctx.moveTo(SX[EA[e]], SY[EA[e]]); ctx.lineTo(SX[EB[e]], SY[EB[e]]);
        }
        ctx.stroke();

        // Neuronas apagadas: puntos grises.
        const base = (canvas.clientWidth < 500 ? 1.0 : 1.25) * dpr;
        const dim = [0.24, 0.4, 0.6];
        for (let b = 0; b < 3; b++) {
            ctx.fillStyle = 'rgba(150,165,195,' + dim[b] + ')';
            ctx.beginPath();
            for (let i = 0; i < N; i++) {
                if (ON[i] || SB[i] !== b) continue;
                const r = base * SK[i] * 0.8;
                ctx.rect(SX[i] - r, SY[i] - r, r * 2, r * 2);
            }
            ctx.fill();
        }

        // Lo encendido se suma («lighter»): donde se juntan muchas luces, brilla más.
        ctx.globalCompositeOperation = 'lighter';
        for (let p = 0; p < PHASES; p++) {
            ctx.strokeStyle = COLORS[p];
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            for (let e = 0; e < E; e++) {
                if (!ELIT[e] || EP[e] !== p) continue;
                ctx.moveTo(SX[EA[e]], SY[EA[e]]); ctx.lineTo(SX[EB[e]], SY[EB[e]]);
            }
            ctx.stroke();
        }
        const halo = [0.09, 0.14, 0.2], core = [0.5, 0.75, 1];
        for (let p = 0; p < PHASES; p++) {
            ctx.fillStyle = COLORS[p];
            for (let b = 0; b < 3; b++) {
                for (let pass = 0; pass < 2; pass++) {     // 0 = halo grande y suave, 1 = centro pequeño y vivo
                    ctx.globalAlpha = pass ? core[b] : halo[b];
                    ctx.beginPath();
                    for (let i = 0; i < N; i++) {
                        if (!ON[i] || PH[i] !== p || SB[i] !== b) continue;
                        const r = base * SK[i] * (pass ? 1.25 : 3.2);
                        ctx.moveTo(SX[i] + r, SY[i]);
                        ctx.arc(SX[i], SY[i], r, 0, TAU);
                    }
                    ctx.fill();
                }
            }
        }

        // Destello de las que se acaban de encender.
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < N; i++) {
            if (GLOW[i] <= 0.02) continue;
            ctx.globalAlpha = GLOW[i] * 0.3;
            ctx.beginPath();
            ctx.arc(SX[i], SY[i], base * SK[i] * (1.3 + 2 * GLOW[i]), 0, TAU);
            ctx.fill();
            GLOW[i] = calm.matches ? 0 : Math.max(0, GLOW[i] - dt * 1.6);
        }

        // Impulsos que viajan por las conexiones encendidas.
        if (!calm.matches && lit.length) {
            const want = Math.min(70, Math.ceil(lit.length / 10));
            while (pulses.length < want) pulses.push({ e: lit[Math.floor(Math.random() * lit.length)], t: Math.random(), v: 0.5 + Math.random() * 0.9 });
            pulses.length = want;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            for (const q of pulses) {
                q.t += dt * q.v;
                if (q.t >= 1 || !ELIT[q.e]) { q.e = lit[Math.floor(Math.random() * lit.length)]; q.t = 0; }
                const a = EA[q.e], b = EB[q.e];
                const x = SX[a] + (SX[b] - SX[a]) * q.t, y = SY[a] + (SY[b] - SY[a]) * q.t, r = base * 1.5;
                ctx.moveTo(x + r, y);
                ctx.arc(x, y, r, 0, TAU);
            }
            ctx.fill();
        } else {
            pulses.length = 0;
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    function frame(now) {
        raf = 0;
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        let moving = false;
        for (let p = 0; p < PHASES; p++) {
            const d = target[p] - shown[p];
            if (Math.abs(d) < 0.0005) { shown[p] = target[p]; continue; }
            shown[p] += calm.matches ? d : d * Math.min(1, dt * 2.2);     // se acerca suave al objetivo
            moving = true;
        }
        updateOn();
        if (!calm.matches && !dragging && now > resumeAt) yaw += dt * 0.18;   // gira sola
        draw(dt);
        // Con «Reducir movimiento» solo se dibuja cuando algo cambia; si no, en cada cuadro.
        if (!calm.matches || moving) schedule();
    }
    function schedule() {
        if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    }

    // ---------- 4. Ratón, dedo y teclado ----------

    let lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sin captura: sigue funcionando */ }
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        yaw += (e.clientX - lastX) * 0.008;
        pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.clientY - lastY) * 0.008));
        lastX = e.clientX; lastY = e.clientY;
        schedule();
    });
    const release = () => { dragging = false; resumeAt = performance.now() + 2500; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    const zoomBy = (f) => { zoom = Math.max(0.6, Math.min(2.6, zoom * f)); schedule(); };
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
        if (step) { yaw += step[0]; pitch = Math.max(-1.3, Math.min(1.3, pitch + step[1])); resumeAt = performance.now() + 2500; }
        else if (e.key === '+' || e.key === '=') zoomBy(1.15);
        else if (e.key === '-') zoomBy(1 / 1.15);
        else return;
        e.preventDefault();
        schedule();
    });

    // ---------- 5. Textos (inglés y español) ----------

    const T = {
        en: {
            back: '← Huerga Labs', by: 'by Huerga Labs',
            lede: 'An AI brain I am building from scratch, in public: from the first lines of Python to a mini-GPT and my own models. Every neuron that lights up is something Brainy has already learned.',
            learned: 'learned', tip: 'Drag to rotate · wheel to zoom', timeline: 'Timeline',
            play: '▶ Replay from 0', live: 'Now', sim: 'Simulate 100%',
            total: 'Total progress', neurons: 'Active neurons', milestones: 'Milestones',
            path: 'The path', phase: 'Phase', curve: 'Learning curve',
            curveNote: 'Accuracy of the first network (handwritten digits, MNIST) at each training epoch.',
            curveEmpty: 'No data yet: it will appear when the first network is trained.',
            modeLive: 'Now', modeSim: 'Simulation: how it will look when the path is complete', modePlay: 'Replaying the learning…',
            born: 'Brainy is born', offline: 'Brainy is resting: I could not load the progress right now. Try again in a moment.',
            notStarted: 'The path starts here: no milestones yet.',
            about: 'How it works',
            aboutText: 'The brain is drawn with plain JavaScript on a canvas, with no 3D library. Each phase of the plan is a brain region; a neuron turns on when the progress of its phase reaches it. The timeline replays the learning from day one.',
            footer: 'Brainy by Huerga Labs · built from scratch by Reynaldo Huerga',
            title: 'Brainy by Huerga Labs',
            desc: 'An AI brain built from scratch, in public. Watch Brainy learn: every neuron that lights up is something it already knows.',
            canvas: '3D brain: each dot is a neuron and lights up when a milestone is completed.',
        },
        es: {
            back: '← Huerga Labs', by: 'by Huerga Labs',
            lede: 'Un cerebro de IA que construyo desde cero, en público: desde las primeras líneas de Python hasta un mini-GPT y mis propios modelos. Cada neurona que se enciende es algo que Brainy ya aprendió.',
            learned: 'aprendido', tip: 'Arrastra para girar · rueda para acercar', timeline: 'Línea temporal',
            play: '▶ Reproducir desde 0', live: 'Ahora', sim: 'Simular 100 %',
            total: 'Progreso total', neurons: 'Neuronas activas', milestones: 'Hitos',
            path: 'El camino', phase: 'Fase', curve: 'Curva de aprendizaje',
            curveNote: 'Precisión de la primera red (dígitos escritos a mano, MNIST) en cada época de entrenamiento.',
            curveEmpty: 'Aún no hay datos: aparecerán al entrenar la primera red.',
            modeLive: 'Ahora', modeSim: 'Simulación: así se verá al completar el camino', modePlay: 'Reproduciendo el aprendizaje…',
            born: 'Nace Brainy', offline: 'Brainy está descansando: no pude cargar el progreso ahora mismo. Prueba de nuevo en un momento.',
            notStarted: 'El camino empieza aquí: todavía no hay hitos.',
            about: 'Cómo funciona',
            aboutText: 'El cerebro se dibuja con JavaScript puro sobre un canvas, sin ninguna librería 3D. Cada fase del plan es una región del cerebro; una neurona se enciende cuando el progreso de su fase llega hasta ella. La línea temporal reproduce el aprendizaje desde el primer día.',
            footer: 'Brainy by Huerga Labs · construido desde cero por Reynaldo Huerga',
            title: 'Brainy by Huerga Labs',
            desc: 'Un cerebro de IA construido desde cero, en público. Mira a Brainy aprender: cada neurona que se enciende es algo que ya sabe.',
            canvas: 'Cerebro en 3D: cada punto es una neurona y se enciende al completar un hito.',
        },
    };
    // brainy.json trae los nombres en español (los del plan). En inglés se usan estos; si falta alguno, el del JSON.
    const EN = {
        phases: { 1: 'Python + PyTorch', 2: 'How a network learns', 3: 'Mini-GPT', 4: 'A useful model', 5: 'The full brain' },
        milestones: {
            f1_numpy: 'NumPy: numbers in bulk', f1_tensores: 'Tensors, GPU and autograd', f1_mnist: 'First network: MNIST digits', f1_ejercicios: 'Phase 1 exercises',
            f2_micrograd: 'micrograd: gradients by hand', f2_bigramas: 'makemore: bigrams', f2_mlp: 'makemore: MLP network', f2_nombres: 'My own name generator',
            f3_tokenizador: 'BPE tokenizer', f3_atencion: 'Self-attention', f3_transformer: 'Transformer blocks', f3_gpt: 'Mini-GPT trained in Spanish',
            f4_dataset: 'Dataset of app logs', f4_clasificador: 'Trained classifier', f4_panel: 'Connected to the admin panel',
            f5_memoria: 'Semantic memory (pgvector)', f5_ollama: 'Local model with Ollama', f5_router: 'Decision router', f5_claude: 'Escalation to Claude', f5_mcp: 'API + MCP server',
        },
    };
    const REGIONS = {
        en: ['Occipital', 'Parietal', 'Temporal (language)', 'Frontal', 'Connections'],
        es: ['Occipital', 'Parietal', 'Temporal (lenguaje)', 'Frontal', 'Conexiones'],
    };
    const t = (key) => (T[lang] && T[lang][key]) || T.en[key] || '';
    const phaseName = (p) => (lang === 'en' && EN.phases[p.id]) || p.name;
    const milestoneName = (m) => (lang === 'en' && EN.milestones[m.id]) || m.name;

    // ---------- 6. Panel: cifras y camino ----------

    const pctEls = document.querySelectorAll('[data-brain-pct]');
    const doneEl = document.getElementById('brain-done');
    const totalEl = document.getElementById('brain-total');
    const pathEl = document.getElementById('brain-path');
    const msgEl = document.getElementById('brain-msg');
    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const day = (iso) => {
        const d = iso ? new Date(iso + 'T12:00:00') : null;
        return d && !isNaN(d) ? d.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    };

    // Todo el texto entra con textContent (nunca como HTML): lo que venga en el JSON no puede inyectar nada.
    function renderPanel() {
        // La página pública muestra solo el cerebro: si no hay lista de fases en el HTML, no se arma.
        if (pathEl) pathEl.textContent = '';
        if (pathEl) data.phases.forEach((p, i) => {
            const box = make('div', 'phase');
            const head = make('div', 't');
            const dot = make('i'); dot.style.background = COLORS[i % PHASES];
            head.append(dot, make('b', null, t('phase') + ' ' + p.id + ' · ' + phaseName(p)), make('span', null, REGIONS[lang][i] || ''), make('em'));
            head.lastChild.dataset.count = '';
            const bar = make('div', 'bar'), fill = make('i');
            fill.dataset.bar = ''; fill.style.background = COLORS[i % PHASES];
            bar.append(fill);
            const list = make('ul');
            p.milestones.forEach((m) => {
                const li = make('li', null, milestoneName(m));
                li.dataset.milestone = m.id;
                if (m.done && m.date) li.append(make('small', null, day(m.date)));
                list.append(li);
            });
            box.append(head, bar, list);
            pathEl.append(box);
        });
        if (msgEl) { msgEl.hidden = loaded; msgEl.textContent = loaded ? '' : t('offline'); }
        if (totalEl) totalEl.textContent = '/ ' + fmt(N);
        if (neuronsEl) neuronsEl.textContent = fmt(active);
    }

    function paintPanel(progress, done) {
        const mean = progress.reduce((a, b) => a + b, 0) / (progress.length || 1);
        pctEls.forEach((el) => { el.textContent = Math.round(mean * 100) + ' %'; });
        let all = 0, ok = 0;
        document.querySelectorAll('#brain-path .phase').forEach((el, i) => {
            const items = [...el.querySelectorAll('[data-milestone]')];
            let here = 0;
            items.forEach((li) => { const on = done.has(li.dataset.milestone); li.classList.toggle('done', on); if (on) here++; });
            all += items.length; ok += here;
            const count = el.querySelector('[data-count]'), bar = el.querySelector('[data-bar]');
            if (count) count.textContent = here + '/' + items.length;
            if (bar) bar.style.width = Math.round((progress[i] || 0) * 100) + '%';
        });
        if (doneEl) doneEl.textContent = ok + '/' + all;
    }

    // ---------- 7. Línea temporal (la cuarta dimensión) ----------

    const slider = document.getElementById('brain-slider');
    const whenEl = document.getElementById('brain-when');
    const modeEl = document.getElementById('brain-mode');
    let mode = 'live', timer = 0;

    const fill = (v) => new Array(PHASES).fill(v);
    const allIds = () => data.phases.flatMap((p) => p.milestones.map((m) => m.id));
    const nowDone = () => new Set(data.phases.flatMap((p) => p.milestones.filter((m) => m.done).map((m) => m.id)));
    const doneAt = (k) => new Set(data.history.slice(0, k + 1).map((h) => h.milestone).filter(Boolean));
    // El progreso de cada fase con un conjunto de hitos hechos (la página lo calcula sola: el JSON solo trae hitos).
    const progressOf = (done) => fill(0).map((_, i) => {
        const ms = data.phases[i] ? data.phases[i].milestones : [];
        return ms.length ? ms.filter((m) => done.has(m.id)).length / ms.length : 0;
    });
    const lastIndex = () => Math.max(0, data.history.length - 1);

    function label(entry) {
        if (!entry) return loaded ? t('notStarted') : '';
        let name = t('born');
        if (entry.milestone) {
            const m = data.phases.flatMap((p) => p.milestones).find((x) => x.id === entry.milestone);
            name = m ? milestoneName(m) : '';
        }
        return [day(entry.date), name].filter(Boolean).join(' · ');
    }
    function show(done, text, modeText) {
        const progress = progressOf(done);
        target = progress;
        paintPanel(progress, done);
        if (whenEl) whenEl.textContent = text;
        if (modeEl) modeEl.textContent = modeText;
        schedule();
    }
    function stop() { clearInterval(timer); timer = 0; }

    function goLive() {
        stop(); mode = 'live';
        if (slider) slider.value = lastIndex();
        show(nowDone(), label(data.history[lastIndex()]), t('modeLive'));
    }
    function goTo(k) {
        const entry = data.history[k];
        if (!entry || k >= lastIndex()) return goLive();
        mode = 'past';
        if (slider) slider.value = k;
        show(doneAt(k), label(entry), label(entry));
    }
    function play() {
        stop(); mode = 'play';
        shown.fill(0); updateOn();                 // empieza apagado del todo
        let k = 0;
        const step = () => {
            if (k > lastIndex() || !data.history.length) return goLive();
            if (slider) slider.value = k;
            show(doneAt(k), label(data.history[k]), t('modePlay'));
            k++;
        };
        step();
        timer = setInterval(step, 1400);
    }
    function simulate() {
        stop(); mode = 'sim';
        show(new Set(allIds()), t('modeSim'), t('modeSim'));
    }
    function repaint() {                           // tras cambiar de idioma o llegar datos: lo mismo, con los textos nuevos
        if (mode === 'sim') simulate();
        else if (mode === 'past') goTo(Number(slider ? slider.value : 0));
        else if (mode !== 'play') goLive();
    }

    slider?.addEventListener('input', () => { stop(); goTo(Number(slider.value)); });
    document.getElementById('brain-play')?.addEventListener('click', play);
    document.getElementById('brain-live')?.addEventListener('click', goLive);
    document.getElementById('brain-sim')?.addEventListener('click', simulate);

    // ---------- 8. Curva de aprendizaje ----------

    const curve = document.getElementById('brain-curve');
    const curveEmpty = document.getElementById('brain-curve-empty');

    function drawCurve() {
        if (!curve) return;
        const points = data.metrics.mnist_precision;
        curve.hidden = !points.length;
        if (curveEmpty) curveEmpty.hidden = !!points.length;
        if (!points.length) return;
        const c = curve.getContext('2d');
        const r = Math.min(window.devicePixelRatio || 1, 2);
        const w = curve.width = Math.max(1, Math.round(curve.clientWidth * r)), h = curve.height = Math.max(1, Math.round(curve.clientHeight * r));
        const lo = Math.min(...points), hi = Math.max(...points), span = Math.max(hi - lo, 1);
        const padX = 8 * r, top = 20 * r, bottom = 20 * r;
        const xAt = (i) => padX + (points.length < 2 ? 0.5 : i / (points.length - 1)) * (w - padX * 2);
        const yAt = (v) => top + (1 - (v - lo) / span) * (h - top - bottom);
        const css = getComputedStyle(curve);
        c.clearRect(0, 0, w, h);
        c.strokeStyle = css.getPropertyValue('--accent').trim() || COLORS[1];
        c.fillStyle = c.strokeStyle; c.lineWidth = 2 * r; c.lineJoin = 'round';
        c.beginPath();
        points.forEach((v, i) => (i ? c.lineTo(xAt(i), yAt(v)) : c.moveTo(xAt(i), yAt(v))));
        c.stroke();
        points.forEach((v, i) => { c.beginPath(); c.arc(xAt(i), yAt(v), 2.5 * r, 0, TAU); c.fill(); });
        c.fillStyle = css.color; c.font = (11 * r) + 'px "IBM Plex Mono", ui-monospace, monospace';
        const pct = (v) => v.toLocaleString(lang, { maximumFractionDigits: 1 }) + ' %';
        c.textAlign = 'left'; c.fillText(pct(points[0]), padX, h - 5 * r);
        c.textAlign = 'right'; c.fillText(pct(points[points.length - 1]), w - padX, 12 * r);
    }

    // ---------- 9. Idioma (mismo selector y misma memoria que la portada) ----------

    function setLang(next, save) {
        lang = T[next] ? next : 'en';
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach((el) => { const text = t(el.dataset.i18n); if (text) el.textContent = text; });
        document.title = t('title');
        document.getElementById('metaDesc')?.setAttribute('content', t('desc'));
        canvas.setAttribute('aria-label', t('canvas'));
        document.querySelectorAll('.lang [data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false'));
        if (save) { try { localStorage.setItem('lang', lang); } catch (e) { /* sin almacenamiento: no pasa nada */ } }
        renderPanel();
        repaint();
        drawCurve();
    }
    document.querySelectorAll('.lang [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang, true)));

    // ---------- 10. Cargar brainy.json ----------

    // Solo se acepta lo que tiene la forma esperada; lo demás se descarta.
    function clean(raw) {
        const text = (v) => (typeof v === 'string' ? v.slice(0, 80) : '');
        const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
        const id = (v) => (typeof v === 'string' && /^[a-z0-9_]{1,40}$/.test(v) ? v : null);
        const phases = (Array.isArray(raw.phases) ? raw.phases : []).slice(0, PHASES).map((p, i) => ({
            id: Number.isInteger(p && p.id) ? p.id : i + 1,
            name: text(p && p.name),
            milestones: (Array.isArray(p && p.milestones) ? p.milestones : []).slice(0, 12)
                .filter((m) => m && id(m.id)).map((m) => ({ id: m.id, name: text(m.name), done: m.done === true, date: date(m.date) })),
        }));
        const known = new Set(phases.flatMap((p) => p.milestones.map((m) => m.id)));
        const history = (Array.isArray(raw.history) ? raw.history : []).slice(0, 60)
            .filter((h) => h && (h.milestone === null || known.has(h.milestone)))
            .map((h) => ({ date: date(h.date), milestone: h.milestone }));
        const points = raw.metrics && Array.isArray(raw.metrics.mnist_precision) ? raw.metrics.mnist_precision : [];
        return { phases, history, metrics: { mnist_precision: points.map(Number).filter((v) => isFinite(v) && v >= 0 && v <= 100).slice(-50) } };
    }

    async function load() {
        try {
            const res = await fetch('brainy.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error('http');
            const fresh = clean(await res.json());
            if (!fresh.phases.length) throw new Error('vacío');
            data = fresh; loaded = true;
        } catch (e) {
            loaded = false;                        // sin datos: cerebro apagado y un mensaje tranquilo
        }
        if (slider) { slider.max = lastIndex(); slider.value = lastIndex(); slider.disabled = data.history.length < 2; }
        renderPanel();
        if (loaded && new URLSearchParams(location.search).get('sim') === '1') simulate(); else repaint();
        drawCurve();
    }

    // ---------- Arranque ----------

    if (window.ResizeObserver) new ResizeObserver(() => { resize(); drawCurve(); }).observe(canvas);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { last = performance.now(); schedule(); });
    calm.addEventListener?.('change', schedule);
    {
        const fromUrl = new URLSearchParams(location.search).get('lang');
        let saved = null;
        try { saved = localStorage.getItem('lang'); } catch (e) { /* sin almacenamiento */ }
        const browser = (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
        setLang(fromUrl || saved || browser, !!fromUrl);
    }
    resize();
    updateOn();
    load();
})();
