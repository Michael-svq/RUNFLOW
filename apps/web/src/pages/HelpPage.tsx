import { Link } from 'react-router';
import { Logo } from '@runflow/ui';

/*
 * Ayuda de usuario (lanzamiento): cómo se trabaja con RunFlow, por puesto.
 * Pública, para poder enlazarla desde la portada y desde la aplicación.
 */

const SECTIONS: { id: string; title: string; items: string[] }[] = [
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    items: [
      'Quien administra la empresa da de alta a las personas en 07 Gestión de usuarios y les asigna un rol (redactor, realizador, operador de CG, presentador, técnico…). Cada rol ve y puede hacer lo suyo.',
      'Los programas agrupan las escaletas de cada día. En 04 Escaletas creas una escaleta nueva, en blanco o desde una plantilla.',
      'Arriba a la izquierda cambias de empresa si perteneces a varias; abajo, el tema Interior (control) o Exterior (mucha luz).',
    ],
  },
  {
    id: 'escaleta',
    title: 'La escaleta',
    items: [
      'Funciona como una hoja de cálculo: escribe en una celda y pulsa Intro; copia y pega desde Excel o Google Sheets; arrastra el número para mover una línea.',
      'Varias personas editan a la vez y ves dónde está cada una. Sin conexión puedes seguir: al volver, todo se fusiona.',
      'Columna TIPO: ACTING, TEMA, VTR, COLAS… cada uno con su color. ESTADO: C cae, E emitido, X no listo, A final.',
      'Clic derecho en una línea: fijar como siguiente, flotante (no cuenta en los tiempos), hora fija, autonext, inicio de bloque, guardar en la nevera.',
      'Vistas por puesto (Completa, Redacción, Realización, Producción, Técnica) y vistas propias con columnas y anchos a tu gusto.',
      'Menú «Escaleta ▾»: datos, guardar como plantilla, importar/exportar (Excel, CSV, copia completa), imprimir y PDF, registro de emisión.',
    ],
  },
  {
    id: 'directo',
    title: 'El directo',
    items: [
      'GO pasa a la siguiente línea (botón, barra espaciadora si la activas, mando o Stream Deck). Volver deshace el último paso.',
      'Modos: Manual, Híbrido (los VTR pasan solos al terminar), Automático y Evento (arranca a la hora).',
      'Relojes: hora, inicio, fin, descuadre, bloque y línea en aire con su coleo. Ámbar a 30 s, rojo a 10 s.',
      'Armar equipos: con la casilla desactivada, o en Ensayo, el GO no mueve CasparCG ni el mezclador.',
      'Si un equipo no responde, aparece ⚠ en la barra de equipos y el directo continúa.',
    ],
  },
  {
    id: 'guion',
    title: 'Guion y rótulos',
    items: [
      'Abre el panel y elige una línea. Paso (verde, Ctrl+1) es lo que lee el presentador; Off (negro, Ctrl+2) lo que se locuta en la pieza; Nota (gris, Ctrl+3) no sale en el prompter.',
      'Los rótulos se añaden con «+ Rótulo…» (o Ctrl+Mayús+R). En los VTR llevan TC de entrada y salida en mm:ss; con solo TC de entrada salen a los 6 s.',
      'El tiempo de lectura del paso (3 palabras por segundo) puede pasar al TIEMPO ESTIMADO con un clic.',
      '«✦ IA» corrige, escribe el paso o el off, ajusta a una duración, resume teletipos, sugiere rótulos o traduce. Siempre revisas la propuesta antes de usarla.',
    ],
  },
  {
    id: 'prompter',
    title: 'Teleprompter y salidas',
    items: [
      'Prompter muestra el paso en grande; se controla con teclado, rueda, pedal o una tablet y puede seguir al GO.',
      'Salidas: crea enlaces para el prompter, el presentador, los relojes, la agenda, los mensajes o la multivista y ábrelos en cualquier pantalla, sin usuario. Se revocan cuando quieras.',
      'Mando: una salida con botones grandes de GO, volver y rótulos para una tablet; sus URL sirven también para Companion / Stream Deck.',
    ],
  },
  {
    id: 'cg',
    title: 'Rótulos en CasparCG y mezcladores',
    items: [
      'En 10 Configuración añade CasparCG (y OBS, vMix o ATEM) y diseña los rótulos con la vista previa: es la misma plantilla que sale en antena.',
      'En la escaleta, cada rótulo tiene ▶ para lanzarlo y ■ para sacarlo; los de los VTR salen solos en su TC.',
      'La columna CLIP guarda el archivo del vídeo y PLAY muestra si está preparado, cuánto le queda o si falta en CasparCG.',
      'La columna FUENTE (CAM 1, VTR…) dice a qué entrada corta el mezclador con cada GO, según el mapa de fuentes del equipo.',
    ],
  },
  {
    id: 'station',
    title: 'RunFlow Station',
    items: [
      'Un ordenador del estudio con RunFlow Station hace de servidor local: el resto de equipos entra con el navegador en su dirección.',
      'Enlazada con la nube, si se cae internet el directo sigue en el estudio y al volver todo se sincroniza.',
      'También funciona sola, sin nube, con una licencia por estudio.',
    ],
  },
  {
    id: 'atajos',
    title: 'Atajos de teclado',
    items: [
      'Intro: editar o confirmar una celda · Esc: cancelar · Supr: vaciar celdas · Ctrl+Z / Ctrl+Y: deshacer y rehacer.',
      'Ctrl+C / Ctrl+V: copiar y pegar celdas (también desde una hoja de cálculo).',
      'Espacio: GO (si está activado «Espacio = GO»).',
      'En el guion: Ctrl+1 paso, Ctrl+2 off, Ctrl+3 nota, Ctrl+Mayús+R rótulo TOT.',
    ],
  },
];

export function HelpPage() {
  return (
    <div className="rf-help">
      <header className="rf-landing__top">
        <Link to="/" className="rf-landing__logo" aria-label="Inicio">
          <Logo size={24} />
          <span className="rf-auth__tv">.TV</span>
        </Link>
        <nav className="rf-landing__nav" aria-label="Ayuda">
          <Link to="/entrar" className="rf-btn rf-btn--secondary rf-btn--sm">
            Entrar
          </Link>
        </nav>
      </header>
      <main className="rf-help__body">
        <h1>Ayuda de RunFlow</h1>
        <nav className="rf-help__toc" aria-label="Índice">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="rf-help__section">
            <h2>{s.title}</h2>
            <ul>
              {s.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
